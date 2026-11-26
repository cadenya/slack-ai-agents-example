import assert from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { setCadenyaClient } from '../../cadenya/client.js';
import { threadLabels } from '../../cadenya/thread.js';
import { handleWebhookEvent } from '../../cadenya/webhook-events.js';
import { fakeCadenya, fakeSlack, SILENT_LOGGER, THREAD } from './fakes.js';

let objectiveCount = 0;
let objectiveId = 'obj_0';

/**
 * @param {Record<string, any>} data
 * @param {Record<string, any>} [extra]
 * @returns {any}
 */
function webhookEvent(data, extra = {}) {
  return {
    type: 'objective_event.test',
    data: {
      objective: { id: objectiveId, labels: threadLabels(THREAD) },
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
    objectiveId = `obj_${++objectiveCount}`;
    deps = { client: fakeSlack(), logger: SILENT_LOGGER };
  });

  afterEach(() => setCadenyaClient(undefined));

  it('renders an assistant message into the thread named in the labels', async () => {
    await handleWebhookEvent(
      webhookEvent({ type: 'assistantMessage', assistantMessage: { content: 'Hi!', toolCalls: [] } }),
      deps,
    );
    const [reply] = deps.client.streams;
    assert.strictEqual(reply.args.channel, 'C123');
    assert.strictEqual(reply.args.thread_ts, '1.0');
    assert.deepStrictEqual(reply.chunks, [{ type: 'markdown_text', text: 'Hi!' }]);
    assert.strictEqual(reply.stopped.blocks[0].type, 'context_actions');
  });

  it('opens no message for an assistant message that only requests tool calls', async () => {
    await handleWebhookEvent(
      webhookEvent({ type: 'assistantMessage', assistantMessage: { toolCalls: [{ toolCallId: 'toolcall_1' }] } }),
      deps,
    );
    assert.strictEqual(deps.client.streams.length, 0);
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
    assert.strictEqual(deps.client.streams.length, 0);
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
      objectiveId,
      'toolcall_1',
      { content: [{ type: 'text', text: { text: 'Reacted with :tada:' } }] },
    ]);
  });

  it('shows other tool calls as tasks in a plan', async () => {
    await handleWebhookEvent(
      webhookEvent({ type: 'toolCalled', toolCalled: { toolCallId: 'toolcall_1', llmToolName: 'search_orders' } }),
      deps,
    );
    assert.deepStrictEqual(deps.client.streams[0].chunks.at(-1), {
      type: 'task_update',
      id: 'toolcall_1',
      title: 'search_orders',
      status: 'in_progress',
    });
    assert.strictEqual(cadenya.objectives.setToolCallContent.mock.callCount(), 0);
  });

  it("shows a sub-agent's tool calls as the thread status, not in the plan", async () => {
    await handleWebhookEvent(
      webhookEvent(
        { type: 'toolCalled', toolCalled: { toolCallId: 'toolcall_1', llmToolName: 'search_orders' } },
        { parentObjective: { id: 'obj_parent' }, rootObjective: { id: 'obj_root', labels: threadLabels(THREAD) } },
      ),
      deps,
    );
    assert.strictEqual(
      deps.client.assistant.threads.setStatus.mock.calls[0].arguments[0].status,
      'Using search_orders…',
    );
    assert.strictEqual(deps.client.streams.length, 0);
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
      objectiveId,
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
