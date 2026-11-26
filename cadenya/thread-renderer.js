import { buildFeedbackBlocks } from '../listeners/views/feedback-builder.js';
import { isClientToolCall, postApprovalRequest, postError, runClientTool } from './thread-actions.js';
import { ThreadReply } from './thread-reply.js';

/** @typedef {import('./thread.js').SlackThread} SlackThread */
/** @typedef {import('./thread-actions.js').ThreadDeps} ThreadDeps */
/** @typedef {import('@cadenya/cadenya').ObjectiveEvent} ObjectiveEvent */

const QUIET_STATES = new Set([
  'OBJECTIVE_STATE_WAITING',
  'OBJECTIVE_STATE_FINALIZED',
  'OBJECTIVE_STATE_FAILED',
  'OBJECTIVE_STATE_CANCELLED',
  'OBJECTIVE_STATE_TIMED_OUT',
]);

/**
 * Renders one objective's events into its Slack thread. Events that share an
 * iteration ID become one Slack message: the assistant's text, and a plan with
 * a task per tool call that updates as each call settles.
 */
export class ThreadRenderer {
  #deps;
  #thread;
  #objectiveId;
  #reply;
  /** @type {string | undefined} */
  #iterationId;
  /** @type {Set<string>} */
  #pendingToolCalls = new Set();
  /** @type {Set<string>} */
  #settledToolCalls = new Set();
  #toolCallCount = 0;
  #planTitled = false;
  isQuiet = false;

  /**
   * @param {ThreadDeps} deps
   * @param {SlackThread} thread
   * @param {string} objectiveId
   */
  constructor(deps, thread, objectiveId) {
    this.#deps = deps;
    this.#thread = thread;
    this.#objectiveId = objectiveId;
    this.#reply = new ThreadReply(deps, thread);
  }

  /**
   * @param {ObjectiveEvent} event
   * @returns {Promise<void>}
   */
  async handle(event) {
    const data = event.data;

    switch (data.type) {
      case 'assistantMessage': {
        await this.#enterIteration(event.iterationId);
        const message = data.assistantMessage;
        await this.#reply.appendText(message.content?.trim() ?? '');

        for (const call of message.toolCalls ?? []) {
          if (call.toolCallId && !this.#settledToolCalls.has(call.toolCallId)) {
            this.#pendingToolCalls.add(call.toolCallId);
          }
        }
        this.#toolCallCount = message.toolCalls?.length ?? 0;
        if (this.#toolCallCount === 0) await this.#reply.finish({ blocks: buildFeedbackBlocks() });
        return;
      }
      case 'toolApprovalRequested': {
        const request = data.toolApprovalRequested;
        await this.#enterIteration(event.iterationId);
        await this.#task(request.toolCallId, request.llmToolName, 'in_progress', 'Waiting for approval');
        await postApprovalRequest(this.#deps, this.#thread, this.#objectiveId, request);
        return;
      }
      case 'toolCalled': {
        const call = data.toolCalled;
        await this.#enterIteration(event.iterationId);
        await this.#task(call.toolCallId, call.llmToolName, 'in_progress');
        if (isClientToolCall(call)) await runClientTool(this.#deps, this.#thread, this.#objectiveId, call);
        return;
      }
      case 'toolResult':
        return this.#settle(event, data.toolResult.toolCallId, data.toolResult.llmToolName, 'complete');
      case 'toolError': {
        const { toolCallId, llmToolName, message } = data.toolError;
        return this.#settle(event, toolCallId, llmToolName, 'error', message);
      }
      case 'toolDenied':
        return this.#settle(event, data.toolDenied.toolCallId, data.toolDenied.llmToolName, 'error', 'Denied');
      case 'error': {
        await this.#reply.finish();
        await postError(this.#deps, this.#thread, data.error.message);
        return;
      }
      case 'stateChanged': {
        if (!QUIET_STATES.has(data.stateChanged.toState)) return;
        await this.#reply.finish();
        this.isQuiet = true;
        return;
      }
      default:
        return;
    }
  }

  /**
   * @param {string | undefined} iterationId
   * @returns {Promise<void>}
   */
  async #enterIteration(iterationId) {
    this.isQuiet = false;
    if (iterationId === this.#iterationId) return;
    await this.#reply.finish();
    this.#iterationId = iterationId;
    this.#pendingToolCalls.clear();
    this.#toolCallCount = 0;
    this.#planTitled = false;
  }

  /**
   * @param {string} toolCallId
   * @param {string} toolName
   * @param {import('@slack/types').TaskUpdateChunk['status']} status
   * @param {string} [details]
   * @returns {Promise<void>}
   */
  async #task(toolCallId, toolName, status, details) {
    if (status === 'in_progress' && this.#settledToolCalls.has(toolCallId)) return;
    if (!this.#planTitled) await this.#reply.setPlanTitle('Working on it');
    this.#planTitled = true;
    await this.#reply.updateTask({ id: toolCallId, title: toolName, status, ...(details && { details }) });
  }

  /**
   * @param {ObjectiveEvent} event
   * @param {string} toolCallId
   * @param {string} toolName
   * @param {'complete' | 'error'} status
   * @param {string} [details]
   * @returns {Promise<void>}
   */
  async #settle(event, toolCallId, toolName, status, details) {
    await this.#enterIteration(event.iterationId);
    await this.#task(toolCallId, toolName, status, details);
    this.#settledToolCalls.add(toolCallId);
    this.#pendingToolCalls.delete(toolCallId);
    if (this.#pendingToolCalls.size > 0) return;

    const count = Math.max(this.#toolCallCount, 1);
    await this.#reply.setPlanTitle(`Used ${count} ${count === 1 ? 'tool' : 'tools'}`);
    await this.#reply.finish();
  }
}

/** @type {Map<string, { renderer: ThreadRenderer, queue: Promise<void> }>} */
const active = new Map();

/**
 * Render one event of an objective into its thread. Webhooks for the same
 * objective can arrive side by side, so each objective renders one event at a
 * time. The open Slack message is held in memory between webhooks, and dropped
 * once the objective goes quiet.
 * @param {{ objectiveId: string, thread: SlackThread, event: ObjectiveEvent }} target
 * @param {ThreadDeps} deps
 * @returns {Promise<void>}
 */
export function renderObjectiveEvent({ objectiveId, thread, event }, deps) {
  const entry = active.get(objectiveId) ?? {
    renderer: new ThreadRenderer(deps, thread, objectiveId),
    queue: Promise.resolve(),
  };
  active.set(objectiveId, entry);

  const rendered = entry.queue.then(() => entry.renderer.handle(event));
  entry.queue = rendered
    .catch(() => {})
    .then(() => {
      if (entry.renderer.isQuiet && active.get(objectiveId) === entry) active.delete(objectiveId);
    });
  return rendered;
}
