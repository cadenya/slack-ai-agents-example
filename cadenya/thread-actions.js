import { buildApprovalBlocks } from '../listeners/views/approval-builder.js';
import { cadenya } from './client.js';
import { clientTools } from './client-tools.js';

/** @typedef {import('./thread.js').SlackThread} SlackThread */

/**
 * @typedef {Object} ThreadDeps
 * @property {import('@slack/web-api').WebClient} client
 * @property {Pick<import('@slack/logger').Logger, 'debug' | 'error'>} logger
 */

/**
 * @param {import('@cadenya/cadenya').ToolCalled} call
 * @returns {boolean}
 */
export function isClientToolCall(call) {
  return call.tool?.type === 'tool' && call.tool.clientTool === true && call.llmToolName in clientTools;
}

/**
 * Run a client tool in this app and hand its result back to the objective.
 * @param {ThreadDeps} deps
 * @param {SlackThread} thread
 * @param {string} objectiveId
 * @param {import('@cadenya/cadenya').ToolCalled} call
 * @returns {Promise<void>}
 */
export async function runClientTool({ client }, thread, objectiveId, call) {
  const tool = clientTools[call.llmToolName];
  const text = await tool.execute(call.arguments ?? {}, { client, thread });
  await cadenya().objectives.setToolCallContent(objectiveId, call.toolCallId, {
    content: [{ type: 'text', text: { text } }],
  });
}

/**
 * Ask the thread to approve or deny a tool call.
 * @param {ThreadDeps} deps
 * @param {SlackThread} thread
 * @param {string} objectiveId
 * @param {import('@cadenya/cadenya').ToolApprovalRequested} request
 * @returns {Promise<void>}
 */
export async function postApprovalRequest({ client }, thread, objectiveId, request) {
  await client.chat.postMessage({
    channel: thread.channelId,
    thread_ts: thread.threadTs,
    text: `The agent wants to run ${request.llmToolName} and needs approval.`,
    blocks: buildApprovalBlocks({
      objectiveId,
      toolCallId: request.toolCallId,
      toolName: request.llmToolName,
      toolArguments: request.arguments,
    }),
  });
}

/**
 * @param {ThreadDeps} deps
 * @param {SlackThread} thread
 * @param {string} message
 * @returns {Promise<void>}
 */
export async function postError({ client }, thread, message) {
  await client.chat.postMessage({
    channel: thread.channelId,
    thread_ts: thread.threadTs,
    text: `:warning: The agent hit an error: ${message}`,
  });
}
