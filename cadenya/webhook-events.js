import { buildApprovalBlocks } from '../listeners/views/approval-builder.js';
import { buildFeedbackBlocks } from '../listeners/views/feedback-builder.js';
import { cadenya } from './client.js';
import { clientTools } from './client-tools.js';
import { threadFromLabels } from './thread.js';

/** @typedef {import('@cadenya/cadenya').UnwrapWebhookEvent} WebhookEvent */
/** @typedef {import('./thread.js').SlackThread} SlackThread */

/**
 * @typedef {Object} WebhookDeps
 * @property {import('@slack/web-api').WebClient} client
 * @property {Pick<import('@slack/logger').Logger, 'debug' | 'error'>} logger
 */

const MAX_MARKDOWN_BLOCK_CHARS = 11000;

/**
 * @param {string} text
 * @returns {string[]}
 */
function chunk(text) {
  const chunks = [];
  for (let start = 0; start < text.length; start += MAX_MARKDOWN_BLOCK_CHARS) {
    chunks.push(text.slice(start, start + MAX_MARKDOWN_BLOCK_CHARS));
  }
  return chunks;
}

/**
 * Post the agent's reply into the thread, with feedback buttons on the last message.
 * @param {WebhookDeps} deps
 * @param {SlackThread} thread
 * @param {string} content
 * @returns {Promise<void>}
 */
async function postReply({ client }, thread, content) {
  const chunks = chunk(content);
  for (const [index, text] of chunks.entries()) {
    const isLast = index === chunks.length - 1;
    await client.chat.postMessage({
      channel: thread.channelId,
      thread_ts: thread.threadTs,
      text,
      blocks: [{ type: 'markdown', text }, ...(isLast ? buildFeedbackBlocks() : [])],
    });
  }
}

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
 * Run a client tool in this app and hand its result back to the objective.
 * @param {WebhookDeps} deps
 * @param {SlackThread} thread
 * @param {string} objectiveId
 * @param {import('@cadenya/cadenya').ToolCalled} call
 * @returns {Promise<void>}
 */
async function runClientTool({ client }, thread, objectiveId, call) {
  const tool = clientTools[call.llmToolName];
  const text = await tool.execute(call.arguments ?? {}, { client, thread });
  await cadenya().objectives.setToolCallContent(objectiveId, call.toolCallId, {
    content: [{ type: 'text', text: { text } }],
  });
}

/**
 * Route one verified Cadenya webhook event to the Slack thread named in the
 * objective's labels. Events from sub-agents go to the thread of the objective
 * that started them.
 * @param {WebhookEvent} event
 * @param {WebhookDeps} deps
 * @returns {Promise<void>}
 */
export async function handleWebhookEvent(event, deps) {
  const { objective, rootObjective, parentObjective, objectiveEvent } = event.data;
  const thread = threadFromLabels(rootObjective ?? objective);
  if (!thread) return;

  const data = objectiveEvent.data;

  switch (data.type) {
    case 'assistantMessage': {
      const content = data.assistantMessage.content?.trim();
      if (content && !parentObjective) await postReply(deps, thread, content);
      return;
    }
    case 'toolCalled': {
      const call = data.toolCalled;
      const isClientTool = call.tool?.type === 'tool' && call.tool.clientTool === true;
      if (isClientTool && clientTools[call.llmToolName]) {
        await runClientTool(deps, thread, objective.id, call);
      } else {
        await setStatus(deps, thread, `Using ${call.llmToolName}…`);
      }
      return;
    }
    case 'toolApprovalRequested': {
      const request = data.toolApprovalRequested;
      await deps.client.chat.postMessage({
        channel: thread.channelId,
        thread_ts: thread.threadTs,
        text: `The agent wants to run ${request.llmToolName} and needs approval.`,
        blocks: buildApprovalBlocks({
          objectiveId: objective.id,
          toolCallId: request.toolCallId,
          toolName: request.llmToolName,
          toolArguments: request.arguments,
        }),
      });
      return;
    }
    case 'error': {
      await deps.client.chat.postMessage({
        channel: thread.channelId,
        thread_ts: thread.threadTs,
        text: `:warning: The agent hit an error: ${data.error.message}`,
      });
      return;
    }
    default:
      return;
  }
}
