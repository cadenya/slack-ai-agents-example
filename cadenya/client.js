import Cadenya from '@cadenya/cadenya';

const MAX_RETRIES = 2;

/** @type {Cadenya | undefined} */
let client;

/**
 * The shared Cadenya client. Reads CADENYA_API_KEY, CADENYA_WORKSPACE_ID and
 * CADENYA_WEBHOOK_SECRET from the environment on first use. Reads are retried
 * on transient failures; writes are retried only where a call opts in.
 * @returns {Cadenya}
 */
export function cadenya() {
  client ??= new Cadenya({ maxRetries: MAX_RETRIES });
  return client;
}

/**
 * Replace the shared client, for tests.
 * @param {Cadenya | undefined} replacement
 * @returns {void}
 */
export function setCadenyaClient(replacement) {
  client = replacement;
}

/**
 * The agent that answers in Slack. Accepts an agent ID or `external_id:<value>`.
 * @returns {string}
 */
export function agentId() {
  const id = process.env.CADENYA_AGENT_ID;
  if (!id) throw new Error('Set CADENYA_AGENT_ID to the Cadenya agent that should answer in Slack.');
  return id;
}

/**
 * Request options for a write that is safe to repeat, such as creating an
 * objective under an external ID.
 * @type {import('@cadenya/cadenya').RequestOptions}
 */
export const RETRY_IDEMPOTENT_WRITE = { maxRetries: MAX_RETRIES };
