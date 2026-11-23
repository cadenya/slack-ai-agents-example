import { handleFeedbackButton } from './feedback-buttons.js';
import { handleToolApprovalButton } from './tool-approval-buttons.js';

/**
 * Register action listeners with the Bolt app.
 * @param {import('@slack/bolt').App} app
 * @returns {void}
 */
export function register(app) {
  app.action('feedback', handleFeedbackButton);
  app.action('tool_approve', handleToolApprovalButton);
  app.action('tool_deny', handleToolApprovalButton);
}
