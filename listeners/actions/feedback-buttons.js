import { cadenya } from '../../cadenya/client.js';
import { findThreadObjective } from '../../cadenya/thread.js';

/**
 * Handle feedback button interactions. The thread the button sits in resolves
 * to its Cadenya objective by external ID, and the score feeds the agent's
 * variation selection.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackActionMiddlewareArgs<import('@slack/bolt').BlockFeedbackButtonsAction>} args
 * @returns {Promise<void>}
 */
export async function handleFeedbackButton({ ack, body, client, context, logger }) {
  await ack();

  try {
    const userId = /** @type {string} */ (context.userId);
    const channelId = /** @type {string} */ (body.channel?.id);
    const messageTs = /** @type {string} */ (body.message?.ts);
    const threadTs = /** @type {string} */ (body.message?.thread_ts || messageTs);
    const isPositive = body.actions[0].value === 'good-feedback';

    const objective = await findThreadObjective({
      teamId: /** @type {string} */ (context.teamId),
      channelId,
      threadTs,
    });

    if (objective) {
      await cadenya().objectives.createFeedback(objective.metadata.id, {
        metadata: { labels: { source: 'slack', slack_user: userId } },
        data: {
          score: isPositive ? 1 : -1,
          comment: `${isPositive ? 'Good' : 'Bad'} response, from the Slack feedback buttons.`,
        },
      });
    }

    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      thread_ts: threadTs,
      text: isPositive
        ? 'Glad that was helpful! :tada:'
        : "Sorry that wasn't helpful. :slightly_frowning_face: Try rephrasing your question and I'll give it another shot.",
    });
  } catch (e) {
    logger.error(`Failed to handle feedback: ${e}`);
  }
}
