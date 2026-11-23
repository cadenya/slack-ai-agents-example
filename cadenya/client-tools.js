/**
 * Client tools: defined on each objective, called by the agent, and executed
 * here when the `objective_event.tool_called` webhook arrives.
 */

/** @typedef {import('./thread.js').SlackThread} SlackThread */

/**
 * @typedef {Object} ClientToolContext
 * @property {import('@slack/web-api').WebClient} client
 * @property {SlackThread} thread
 */

/**
 * @typedef {Object} ClientTool
 * @property {import('@cadenya/cadenya').ClientToolDefinition} definition
 * @property {(args: Record<string, unknown>, context: ClientToolContext) => Promise<string>} execute
 */

/**
 * The newest message in the thread written by a person.
 * @param {ClientToolContext} context
 * @returns {Promise<string | undefined>}
 */
async function latestUserMessageTs({ client, thread }) {
  const replies = await client.conversations.replies({ channel: thread.channelId, ts: thread.threadTs, limit: 200 });
  const fromPeople = (replies.messages ?? []).filter((message) => message.user && !message.bot_id);
  return fromPeople.at(-1)?.ts;
}

/** @type {ClientTool} */
const addEmojiReaction = {
  definition: {
    name: 'add_emoji_reaction',
    description:
      "Add an emoji reaction to the user's latest Slack message to acknowledge its topic or tone. " +
      'Use any standard Slack emoji name that fits, for example `tada`, `wrench`, `eyes` or `pray`.',
    parameters: {
      type: 'object',
      properties: {
        emoji_name: { type: 'string', description: "The Slack emoji name without colons, e.g. 'tada'." },
      },
      required: ['emoji_name'],
    },
    requiresApproval: false,
  },
  async execute(args, context) {
    const name = args.emoji_name;
    if (typeof name !== 'string' || !name) return 'add_emoji_reaction requires an emoji_name string.';

    const timestamp = await latestUserMessageTs(context);
    if (!timestamp) return 'There is no user message to react to.';

    try {
      await context.client.reactions.add({ channel: context.thread.channelId, timestamp, name });
      return `Reacted with :${name}:`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Could not add reaction: ${err.data?.error || err.message}`;
    }
  },
};

/** @type {Record<string, ClientTool>} */
export const clientTools = {
  [addEmojiReaction.definition.name]: addEmojiReaction,
};

export const clientToolDefinitions = Object.values(clientTools).map((tool) => tool.definition);
