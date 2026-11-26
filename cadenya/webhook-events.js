import { threadFromLabels } from './thread.js';
import { isClientToolCall, postApprovalRequest, postError, runClientTool } from './thread-actions.js';
import { renderObjectiveEvent } from './thread-renderer.js';

/** @typedef {import('@cadenya/cadenya').UnwrapWebhookEvent} WebhookEvent */
/** @typedef {import('./thread.js').SlackThread} SlackThread */

/**
 * @typedef {Object} WebhookDeps
 * @property {import('@slack/web-api').WebClient} client
 * @property {Pick<import('@slack/logger').Logger, 'debug' | 'error'>} logger
 */

/**
 * Show what the agent is doing in the thread's status line. Status is cosmetic,
 * so a failure here never fails the delivery.
 * @param {WebhookDeps} deps
 * @param {SlackThread} thread
 * @param {string} status
 * @returns {Promise<void>}
 */
async function setStatus({ client, logger }, thread, status) {
  try {
    await client.assistant.threads.setStatus({ channel_id: thread.channelId, thread_ts: thread.threadTs, status });
  } catch (e) {
    logger.debug(`Could not set thread status: ${e}`);
  }
}

/**
 * Route one verified Cadenya webhook event to the Slack thread named in the
 * objective's labels. The thread's own objective renders as Slack messages
 * with a plan of its tool calls. A sub-agent's work stays out of the thread,
 * except for what needs a person: approvals and errors.
 * @param {WebhookEvent} event
 * @param {WebhookDeps} deps
 * @returns {Promise<void>}
 */
export async function handleWebhookEvent(event, deps) {
  const { objective, rootObjective, parentObjective, objectiveEvent } = event.data;
  const thread = threadFromLabels(rootObjective ?? objective);
  if (!thread) return;

  if (!parentObjective) {
    await renderObjectiveEvent({ objectiveId: objective.id, thread, event: objectiveEvent }, deps);
    return;
  }

  const data = objectiveEvent.data;
  switch (data.type) {
    case 'toolCalled': {
      const call = data.toolCalled;
      if (isClientToolCall(call)) return runClientTool(deps, thread, objective.id, call);
      return setStatus(deps, thread, `Using ${call.llmToolName}…`);
    }
    case 'toolApprovalRequested':
      return postApprovalRequest(deps, thread, objective.id, data.toolApprovalRequested);
    case 'error':
      return postError(deps, thread, data.error.message);
    default:
      return;
  }
}
