import { sendToThreadAgent } from '../../cadenya/thread.js';
import { THINKING_STATUS } from './thinking-status.js';

/**
 * Handle app_mention events. The message goes to the thread's Cadenya
 * objective; the reply comes back on the Cadenya webhook.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackEventMiddlewareArgs<'app_mention'>} args
 * @returns {Promise<void>}
 */
export async function handleAppMentioned({ context, event, logger, say, setStatus }) {
  const threadTs = event.thread_ts || event.ts;

  try {
    const cleanedText = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();

    if (!cleanedText) {
      await say({
        text: "Hey there! How can I help you? Ask me anything and I'll do my best.",
        thread_ts: threadTs,
      });
      return;
    }

    const thread = {
      teamId: /** @type {string} */ (context.teamId),
      channelId: event.channel,
      threadTs,
      userId: /** @type {string} */ (context.userId),
    };

    await setStatus(THINKING_STATUS);
    await sendToThreadAgent(thread, cleanedText, { messageTs: event.ts });
  } catch (e) {
    logger.error(`Failed to handle app mention: ${e}`);
    await say({
      text: `:warning: Something went wrong! (${e})`,
      thread_ts: threadTs,
    });
  }
}
