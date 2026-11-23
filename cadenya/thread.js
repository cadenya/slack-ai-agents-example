import { APIError } from '@cadenya/cadenya';

import { agentId, cadenya, RETRY_IDEMPOTENT_WRITE } from './client.js';
import { clientToolDefinitions } from './client-tools.js';

/**
 * A Slack thread, the unit of conversation this app maps to a Cadenya objective.
 * @typedef {Object} SlackThread
 * @property {string} teamId
 * @property {string} channelId
 * @property {string} threadTs
 * @property {string} [userId] - The person who started the conversation.
 */

/** @typedef {import('@cadenya/cadenya').Objective} Objective */

const TERMINAL_STATES = new Set([
  'OBJECTIVE_STATE_FINALIZED',
  'OBJECTIVE_STATE_FAILED',
  'OBJECTIVE_STATE_CANCELLED',
  'OBJECTIVE_STATE_TIMED_OUT',
]);

/**
 * The external ID of a thread's first objective. Slack → Cadenya lookups use it,
 * so the app needs no database of its own.
 * @param {SlackThread} thread
 * @returns {string}
 */
export function threadExternalId({ teamId, channelId, threadTs }) {
  return `slack-${teamId}-${channelId}-${threadTs}`;
}

/**
 * Labels stored on the objective. Every webhook delivery carries them back,
 * so Cadenya → Slack routing needs no lookup either.
 * @param {SlackThread} thread
 * @returns {Record<string, string>}
 */
export function threadLabels({ teamId, channelId, threadTs, userId }) {
  return {
    source: 'slack',
    slack_team: teamId,
    slack_channel: channelId,
    slack_thread_ts: threadTs,
    ...(userId && { slack_user: userId }),
  };
}

/**
 * Read the Slack thread back out of an objective's labels.
 * @param {{ labels?: Record<string, string> } | undefined} metadata
 * @returns {SlackThread | null}
 */
export function threadFromLabels(metadata) {
  const labels = metadata?.labels;
  if (!labels?.slack_team || !labels.slack_channel || !labels.slack_thread_ts) return null;
  return {
    teamId: labels.slack_team,
    channelId: labels.slack_channel,
    threadTs: labels.slack_thread_ts,
    userId: labels.slack_user,
  };
}

/**
 * @param {Objective} objective
 * @returns {boolean}
 */
export function isTerminal(objective) {
  return TERMINAL_STATES.has(objective.state);
}

/**
 * @param {unknown} error
 * @param {number} status
 * @returns {boolean}
 */
function hasStatus(error, status) {
  return error instanceof APIError && error.status === status;
}

/**
 * Find the objective for a thread, or null when the agent was never part of it.
 * The first objective is found by external ID. An external ID is never reusable,
 * so once that objective ends, its successors are found by label, newest first.
 * @param {SlackThread} thread
 * @returns {Promise<Objective | null>}
 */
export async function findThreadObjective(thread) {
  let first;
  try {
    first = await cadenya().objectives.retrieve(`external_id:${threadExternalId(thread)}`);
  } catch (e) {
    if (hasStatus(e, 404)) return null;
    throw e;
  }
  if (!isTerminal(first)) return first;

  const page = await cadenya().objectives.list({
    labels: `slack_channel=${thread.channelId},slack_thread_ts=${thread.threadTs}`,
    sortOrder: 'desc',
    limit: 1,
  });
  for await (const latest of page) return latest;
  return first;
}

/**
 * Send a Slack message to the thread's objective, creating the objective when
 * the thread has none that can still take messages. The reply is not returned
 * here: it arrives on the Cadenya webhook.
 * @param {SlackThread} thread
 * @param {string} text
 * @param {{ messageTs: string, existing?: Objective | null }} options
 * @returns {Promise<void>}
 */
export async function sendToThreadAgent(thread, text, { messageTs, existing }) {
  const objective = existing === undefined ? await findThreadObjective(thread) : existing;

  if (objective && !isTerminal(objective)) {
    await cadenya().objectives.continue(objective.metadata.id, { message: text, enqueue: true });
    return;
  }

  const base = threadExternalId(thread);
  const externalId = objective ? `${base}-${messageTs}` : base;

  try {
    await cadenya().objectives.create(
      {
        agentId: agentId(),
        firstUserMessage: text,
        metadata: { externalId, labels: threadLabels(thread) },
        clientTools: { definitions: clientToolDefinitions },
      },
      RETRY_IDEMPOTENT_WRITE,
    );
  } catch (e) {
    if (hasStatus(e, 409)) return;
    throw e;
  }
}
