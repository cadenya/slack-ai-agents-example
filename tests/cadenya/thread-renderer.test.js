import assert from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { setCadenyaClient } from '../../cadenya/client.js';
import { renderObjectiveEvent, ThreadRenderer } from '../../cadenya/thread-renderer.js';
import { fakeCadenya, fakeSlack, SILENT_LOGGER, THREAD } from './fakes.js';

const TOOLS = 'objiter_tools';
const ANSWER = 'objiter_answer';

/**
 * @param {string | undefined} iterationId
 * @param {string} type
 * @param {Record<string, any>} payload
 * @returns {any}
 */
function event(iterationId, type, payload) {
  return { iterationId, data: { type, [type]: payload } };
}

/**
 * @param {string} toState
 * @returns {any}
 */
function stateChanged(toState) {
  return event(undefined, 'stateChanged', { toState });
}

const FAKER_TURN = [
  event(TOOLS, 'assistantMessage', {
    content: '',
    completionId: 'cmpl_1',
    toolCalls: [{ toolCallId: 'toolcall_1', functionName: 'GenerateFake', arguments: '{}' }],
  }),
  event(TOOLS, 'toolCalled', { toolCallId: 'toolcall_1', llmToolName: 'GenerateFake' }),
  event(TOOLS, 'toolResult', { toolCallId: 'toolcall_1', llmToolName: 'GenerateFake', result: {} }),
  event(ANSWER, 'assistantMessage', { content: 'Meet Vera.', completionId: 'cmpl_2', toolCalls: [] }),
  stateChanged('OBJECTIVE_STATE_WAITING'),
];

describe('ThreadRenderer', () => {
  /** @type {any} */
  let cadenya;
  /** @type {any} */
  let deps;

  beforeEach(() => {
    cadenya = fakeCadenya();
    setCadenyaClient(cadenya);
    deps = { client: fakeSlack(), logger: SILENT_LOGGER };
  });

  afterEach(() => setCadenyaClient(undefined));

  /**
   * @param {any[]} events
   * @returns {Promise<void>}
   */
  const render = async (events) => {
    const renderer = new ThreadRenderer(deps, THREAD, 'obj_1');
    for (const each of events) await renderer.handle(each);
  };

  it('renders each iteration as its own Slack message, in plan mode', async () => {
    await render(FAKER_TURN);
    const [tools, answer] = deps.client.streams;
    assert.strictEqual(deps.client.streams.length, 2);
    assert.deepStrictEqual(tools.args, {
      channel: 'C123',
      thread_ts: '1.0',
      recipient_team_id: 'T1',
      recipient_user_id: 'U123',
      task_display_mode: 'plan',
    });
    assert.deepStrictEqual(tools.chunks, [
      { type: 'plan_update', title: 'Working on it' },
      { type: 'task_update', id: 'toolcall_1', title: 'GenerateFake', status: 'in_progress' },
      { type: 'task_update', id: 'toolcall_1', title: 'GenerateFake', status: 'complete' },
      { type: 'plan_update', title: 'Used 1 tool' },
    ]);
    assert.deepStrictEqual(answer.chunks, [{ type: 'markdown_text', text: 'Meet Vera.' }]);
  });

  it('puts feedback buttons under the final answer only', async () => {
    await render(FAKER_TURN);
    const [tools, answer] = deps.client.streams;
    assert.strictEqual(tools.stopped.blocks, undefined);
    assert.strictEqual(answer.stopped.blocks[0].type, 'context_actions');
  });

  it('shows text the assistant wrote before its tool calls, above the plan', async () => {
    await render([
      event(TOOLS, 'assistantMessage', { content: 'Let me look.', toolCalls: [{ toolCallId: 'toolcall_1' }] }),
      event(TOOLS, 'toolCalled', { toolCallId: 'toolcall_1', llmToolName: 'GenerateFake' }),
    ]);
    assert.strictEqual(deps.client.streams.length, 1);
    assert.deepStrictEqual(deps.client.streams[0].chunks[0], { type: 'markdown_text', text: 'Let me look.' });
    assert.strictEqual(deps.client.streams[0].stopped, undefined);
  });

  it('keeps the plan open until every tool call of the iteration settles', async () => {
    await render([
      event(TOOLS, 'assistantMessage', { toolCalls: [{ toolCallId: 'toolcall_1' }, { toolCallId: 'toolcall_2' }] }),
      event(TOOLS, 'toolCalled', { toolCallId: 'toolcall_1', llmToolName: 'GenerateFake' }),
      event(TOOLS, 'toolCalled', { toolCallId: 'toolcall_2', llmToolName: 'GenerateFake' }),
      event(TOOLS, 'toolError', { toolCallId: 'toolcall_1', llmToolName: 'GenerateFake', message: 'faker is down' }),
    ]);
    const [plan] = deps.client.streams;
    assert.strictEqual(plan.stopped, undefined);
    assert.deepStrictEqual(plan.chunks.at(-1), {
      type: 'task_update',
      id: 'toolcall_1',
      title: 'GenerateFake',
      status: 'error',
      details: 'faker is down',
    });

    const renderer = new ThreadRenderer(deps, THREAD, 'obj_1');
    await renderer.handle(event(TOOLS, 'assistantMessage', { toolCalls: [{ toolCallId: 'a' }, { toolCallId: 'b' }] }));
    await renderer.handle(event(TOOLS, 'toolResult', { toolCallId: 'a', llmToolName: 'GenerateFake' }));
    await renderer.handle(event(TOOLS, 'toolResult', { toolCallId: 'b', llmToolName: 'GenerateFake' }));
    assert.deepStrictEqual(deps.client.streams[1].chunks.at(-1), { type: 'plan_update', title: 'Used 2 tools' });
    assert.deepStrictEqual(deps.client.streams[1].stopped, {});
  });

  it('never moves a settled task back to in progress when webhooks arrive out of order', async () => {
    await render([
      event(TOOLS, 'toolResult', { toolCallId: 'toolcall_1', llmToolName: 'GenerateFake' }),
      event(TOOLS, 'toolCalled', { toolCallId: 'toolcall_1', llmToolName: 'GenerateFake' }),
    ]);
    const statuses = deps.client.streams
      .flatMap((/** @type {any} */ stream) => stream.chunks)
      .filter((/** @type {any} */ chunk) => chunk.type === 'task_update')
      .map((/** @type {any} */ chunk) => chunk.status);
    assert.deepStrictEqual(statuses, ['complete']);
  });

  it('shows a call waiting for approval in the plan and posts the buttons', async () => {
    await render([
      event(TOOLS, 'assistantMessage', { toolCalls: [{ toolCallId: 'toolcall_1' }] }),
      event(TOOLS, 'toolApprovalRequested', { toolCallId: 'toolcall_1', llmToolName: 'GenerateFake', arguments: {} }),
      event(TOOLS, 'toolDenied', { toolCallId: 'toolcall_1', llmToolName: 'GenerateFake', memo: 'no' }),
    ]);
    const [plan] = deps.client.streams;
    assert.strictEqual(plan.chunks[1].details, 'Waiting for approval');
    assert.deepStrictEqual(plan.chunks[2], {
      type: 'task_update',
      id: 'toolcall_1',
      title: 'GenerateFake',
      status: 'error',
      details: 'Denied',
    });
    const buttons = deps.client.chat.postMessage.mock.calls[0].arguments[0];
    assert.strictEqual(buttons.blocks.at(-1).block_id, 'tool_approval');
  });

  it('closes the open message and posts the error when the objective fails', async () => {
    await render([
      event(TOOLS, 'toolCalled', { toolCallId: 'toolcall_1', llmToolName: 'GenerateFake' }),
      event(undefined, 'error', { message: 'model unavailable' }),
    ]);
    assert.deepStrictEqual(deps.client.streams[0].stopped, {});
    assert.match(deps.client.chat.postMessage.mock.calls[0].arguments[0].text, /model unavailable/);
  });
});

describe('renderObjectiveEvent', () => {
  it('renders the events of one objective one at a time, in arrival order', async () => {
    const client = fakeSlack();
    const deps = { client, logger: SILENT_LOGGER };
    const target = { objectiveId: 'obj_queue', thread: THREAD };
    await Promise.all(FAKER_TURN.map((each) => renderObjectiveEvent({ ...target, event: each }, deps)));
    assert.strictEqual(client.streams.length, 2);
    assert.strictEqual(client.streams[0].chunks.at(-1).title, 'Used 1 tool');
    assert.deepStrictEqual(client.streams[1].chunks, [{ type: 'markdown_text', text: 'Meet Vera.' }]);
  });

  it('reports a failed render to its caller, so the webhook is retried', async () => {
    const client = fakeSlack();
    client.chatStream = () => {
      throw new Error('slack is down');
    };
    const failing = event(ANSWER, 'assistantMessage', { content: 'Hi.', toolCalls: [] });
    await assert.rejects(
      renderObjectiveEvent(
        { objectiveId: 'obj_fail', thread: THREAD, event: failing },
        { client, logger: SILENT_LOGGER },
      ),
      /slack is down/,
    );
  });
});
