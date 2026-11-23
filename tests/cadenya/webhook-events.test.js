import assert from 'node:assert';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { setCadenyaClient } from '../../cadenya/client.js';
import { threadLabels } from '../../cadenya/thread.js';
import { handleWebhookEvent } from '../../cadenya/webhook-events.js';
import { fakeCadenya, THREAD } from './fakes.js';

/**
 * @param {Record<string, any>} data
 * @param {Record<string, any>} [extra]
 * @returns {any}
 */
function webhookEvent(data, extra = {}) {
  return {
    type: 'objective_event.test',
    data: {
      objective: { id: 'obj_1', labels: threadLabels(THREAD) },
      objectiveEvent: { data },
      ...extra,
    },
  };
}

describe('handleWebhookEvent', () => {
  /** @type {any} */
  let cadenya;
  /** @type {any} */
  let deps;

  beforeEach(() => {
    cadenya = fakeCadenya();
    setCadenyaClient(cadenya);
    deps = {
      client: {
        chat: { postMessage: mock.fn(async () => ({})) },
        assistant: { threads: { setStatus: mock.fn(async () => ({})) } },
        conversations: { replies: mock.fn(async () => ({ messages: [{ user: 'U123', ts: '2.0' }] })) },
        reactions: { add: mock.fn(async () => ({})) },
      },
      logger: { debug: mock.fn(), error: mock.fn() },
    };
  });

  afterEach(() => setCadenyaClient(undefined));

  it('posts an assistant message into the thread named in the labels', async () => {
    await handleWebhookEvent(
      webhookEvent({ type: 'assistantMessage', assistantMessage: { content: 'Hi!', toolCalls: [] } }),
      deps,
    );
    const message = deps.client.chat.postMessage.mock.calls[0].arguments[0];
    assert.strictEqual(message.channel, 'C123');
    assert.strictEqual(message.thread_ts, '1.0');
    assert.deepStrictEqual(message.blocks[0], { type: 'markdown', text: 'Hi!' });
    assert.strictEqual(message.blocks[1].type, 'context_actions');
  });

  it('does not post an assistant message that only requests tool calls', async () => {
    await handleWebhookEvent(webhookEvent({ type: 'assistantMessage', assistantMessage: { toolCalls: [{}] } }), deps);
    assert.strictEqual(deps.client.chat.postMessage.mock.callCount(), 0);
  });

  it("does not post a sub-agent's messages, which the parent agent summarizes", async () => {
    await handleWebhookEvent(
      webhookEvent(
        { type: 'assistantMessage', assistantMessage: { content: 'internal', toolCalls: [] } },
        { parentObjective: { id: 'obj_0', labels: threadLabels(THREAD) } },
      ),
      deps,
    );
    assert.strictEqual(deps.client.chat.postMessage.mock.callCount(), 0);
  });

  it('ignores objectives that did not start in Slack', async () => {
    const event = webhookEvent({ type: 'assistantMessage', assistantMessage: { content: 'Hi!', toolCalls: [] } });
    event.data.objective.labels = {};
    await handleWebhookEvent(event, deps);
    assert.strictEqual(deps.client.chat.postMessage.mock.callCount(), 0);
  });

  it('runs a client tool and returns its result to the objective', async () => {
    await handleWebhookEvent(
      webhookEvent({
        type: 'toolCalled',
        toolCalled: {
          toolCallId: 'toolcall_1',
          llmToolName: 'add_emoji_reaction',
          arguments: { emoji_name: 'tada' },
          tool: { type: 'tool', clientTool: true },
        },
      }),
      deps,
    );
    assert.deepStrictEqual(deps.client.reactions.add.mock.calls[0].arguments[0], {
      channel: 'C123',
      timestamp: '2.0',
      name: 'tada',
    });
    assert.deepStrictEqual(cadenya.objectives.setToolCallContent.mock.calls[0].arguments, [
      'obj_1',
      'toolcall_1',
      { content: [{ type: 'text', text: { text: 'Reacted with :tada:' } }] },
    ]);
  });

  it('shows other tool calls as the thread status', async () => {
    await handleWebhookEvent(
      webhookEvent({ type: 'toolCalled', toolCalled: { toolCallId: 'toolcall_1', llmToolName: 'search_orders' } }),
      deps,
    );
    assert.strictEqual(
      deps.client.assistant.threads.setStatus.mock.calls[0].arguments[0].status,
      'Using search_orders…',
    );
    assert.strictEqual(cadenya.objectives.setToolCallContent.mock.callCount(), 0);
  });

  it('asks for approval with buttons that carry the Cadenya IDs', async () => {
    await handleWebhookEvent(
      webhookEvent({
        type: 'toolApprovalRequested',
        toolApprovalRequested: { toolCallId: 'toolcall_1', llmToolName: 'refund_order', arguments: { order: 'A1' } },
      }),
      deps,
    );
    const { blocks } = deps.client.chat.postMessage.mock.calls[0].arguments[0];
    const [approve, deny] = blocks.at(-1).elements;
    assert.strictEqual(approve.action_id, 'tool_approve');
    assert.strictEqual(deny.action_id, 'tool_deny');
    assert.deepStrictEqual(JSON.parse(approve.value), {
      objectiveId: 'obj_1',
      toolCallId: 'toolcall_1',
      toolName: 'refund_order',
    });
  });

  it("routes a sub-agent's approval request to the root objective's thread", async () => {
    const event = webhookEvent(
      {
        type: 'toolApprovalRequested',
        toolApprovalRequested: { toolCallId: 'toolcall_9', llmToolName: 'refund_order' },
      },
      { rootObjective: { id: 'obj_root', labels: threadLabels(THREAD) } },
    );
    event.data.objective = { id: 'obj_sub', labels: {} };
    await handleWebhookEvent(event, deps);
    const { channel, blocks } = deps.client.chat.postMessage.mock.calls[0].arguments[0];
    assert.strictEqual(channel, 'C123');
    assert.strictEqual(JSON.parse(blocks.at(-1).elements[0].value).objectiveId, 'obj_sub');
  });
});
