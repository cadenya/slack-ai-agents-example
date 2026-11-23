const MAX_ARGUMENT_CHARS = 2500;

/**
 * @typedef {Object} ApprovalRequest
 * @property {string} objectiveId
 * @property {string} toolCallId
 * @property {string} toolName
 * @property {Record<string, unknown>} [toolArguments]
 */

/**
 * @param {Record<string, unknown> | undefined} toolArguments
 * @returns {string}
 */
function formatArguments(toolArguments) {
  const json = JSON.stringify(toolArguments ?? {}, null, 2);
  return json.length > MAX_ARGUMENT_CHARS ? `${json.slice(0, MAX_ARGUMENT_CHARS)}\n…` : json;
}

/**
 * Build the approve/deny message for a tool call that is waiting on a person.
 * The button value carries the Cadenya IDs, so the click handler needs no lookup.
 * @param {ApprovalRequest} request
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function buildApprovalBlocks({ objectiveId, toolCallId, toolName, toolArguments }) {
  const value = JSON.stringify({ objectiveId, toolCallId, toolName });
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:raised_hand: The agent wants to run \`${toolName}\` and needs approval.`,
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `\`\`\`${formatArguments(toolArguments)}\`\`\`` },
    },
    {
      type: 'actions',
      block_id: 'tool_approval',
      elements: [
        {
          type: 'button',
          action_id: 'tool_approve',
          style: 'primary',
          text: { type: 'plain_text', text: 'Approve' },
          value,
        },
        {
          type: 'button',
          action_id: 'tool_deny',
          style: 'danger',
          text: { type: 'plain_text', text: 'Deny' },
          value,
        },
      ],
    },
  ];
}

/**
 * Build the message that replaces the buttons once someone has decided.
 * @param {{ toolName: string, userId: string, approved: boolean }} decision
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function buildApprovalDecisionBlocks({ toolName, userId, approved }) {
  const verdict = approved ? ':white_check_mark: Approved' : ':no_entry_sign: Denied';
  return [
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `${verdict} \`${toolName}\` — <@${userId}>` }],
    },
  ];
}
