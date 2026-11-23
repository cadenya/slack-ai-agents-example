import { cadenya } from '../../cadenya/client.js';
import { buildApprovalDecisionBlocks } from '../views/approval-builder.js';

/**
 * Handle the Approve and Deny buttons on a tool approval request. The button
 * value carries the objective and tool call IDs that the webhook put there.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackActionMiddlewareArgs<import('@slack/bolt').BlockButtonAction>} args
 * @returns {Promise<void>}
 */
export async function handleToolApprovalButton({ ack, action, context, logger, respond }) {
  await ack();

  const userId = /** @type {string} */ (context.userId);
  const approved = action.action_id === 'tool_approve';

  try {
    const { objectiveId, toolCallId, toolName } = JSON.parse(action.value ?? '{}');

    if (approved) {
      await cadenya().objectives.approveToolCall(objectiveId, toolCallId);
    } else {
      await cadenya().objectives.denyToolCall(objectiveId, toolCallId, {
        memo: `Denied in Slack by <@${userId}>. Do not retry this call without asking first.`,
      });
    }

    await respond({
      replace_original: true,
      text: `${approved ? 'Approved' : 'Denied'} ${toolName}`,
      blocks: buildApprovalDecisionBlocks({ toolName, userId, approved }),
    });
  } catch (e) {
    logger.error(`Failed to handle tool approval: ${e}`);
    await respond({
      replace_original: false,
      response_type: 'ephemeral',
      text: `:warning: Could not record that decision. (${e})`,
    });
  }
}
