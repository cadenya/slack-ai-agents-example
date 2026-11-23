import { findThreadObjective, sendToThreadAgent } from '../../cadenya/thread.js';
import { THINKING_STATUS } from './thinking-status.js';

/**
 * @param {import('@slack/types').MessageEvent} event
 * @returns {event is import('@slack/types').GenericMessageEvent}
 */
function isGenericMessageEvent(event) {
  return !('subtype' in event && event.subtype !== undefined);
}

/**
 * @param {import('@slack/types').GenericMessageEvent} event
 * @param {string | undefined} botUserId
 * @returns {boolean}
 */
function isAppMention(event, botUserId) {
  return event.text?.includes(`<@${botUserId}>`) ?? false;
}

/**
 * Handle messages sent to the agent via DM or in threads the agent is part of.
 * The message goes to the thread's Cadenya objective; the reply comes back on
 * the Cadenya webhook.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackEventMiddlewareArgs<'message'>} args
 * @returns {Promise<void>}
 */
export async function handleMessage({ context, event, logger, say, setStatus }) {
  if (!isGenericMessageEvent(event)) return;
  if (event.bot_id) return;

  const isDm = event.channel_type === 'im';
  const isThreadReply = !!event.thread_ts;
  if (!isDm && !isThreadReply) return;
  if (!isDm && isAppMention(event, context.botUserId)) return;

  try {
    const thread = {
      teamId: /** @type {string} */ (context.teamId),
      channelId: event.channel,
      threadTs: event.thread_ts || event.ts,
      userId: /** @type {string} */ (context.userId),
    };

    const existing = await findThreadObjective(thread);
    if (!isDm && !existing) return;

    await setStatus(THINKING_STATUS);
    await sendToThreadAgent(thread, event.text || '', { messageTs: event.ts, existing });
  } catch (e) {
    logger.error(`Failed to handle message: ${e}`);
    await say({
      text: `:warning: Something went wrong! (${e})`,
      thread_ts: event.thread_ts || event.ts,
    });
  }
}
