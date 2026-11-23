import assert from 'node:assert';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { APIError } from '@cadenya/cadenya';

import { setCadenyaClient } from '../../cadenya/client.js';
import {
  findThreadObjective,
  sendToThreadAgent,
  threadExternalId,
  threadFromLabels,
  threadLabels,
} from '../../cadenya/thread.js';
import { fakeCadenya, objective, THREAD } from './fakes.js';

describe('thread mapping', () => {
  it('derives a stable external ID from the Slack thread', () => {
    assert.strictEqual(threadExternalId(THREAD), 'slack-T1-C123-1.0');
  });

  it('round-trips the thread through objective labels', () => {
    assert.deepStrictEqual(threadFromLabels({ labels: threadLabels(THREAD) }), THREAD);
  });

  it('ignores objectives that did not come from Slack', () => {
    assert.strictEqual(threadFromLabels({ labels: { source: 'api' } }), null);
  });
});

describe('findThreadObjective', () => {
  afterEach(() => setCadenyaClient(undefined));

  it('returns null when the thread has no objective', async () => {
    setCadenyaClient(fakeCadenya());
    assert.strictEqual(await findThreadObjective(THREAD), null);
  });

  it('looks the objective up by external ID', async () => {
    const waiting = objective('OBJECTIVE_STATE_WAITING');
    const cadenya = fakeCadenya({ retrieve: mock.fn(async () => waiting) });
    setCadenyaClient(cadenya);
    assert.strictEqual(await findThreadObjective(THREAD), waiting);
    assert.deepStrictEqual(cadenya.objectives.retrieve.mock.calls[0].arguments, ['external_id:slack-T1-C123-1.0']);
  });

  it('finds the newest objective by label once the first one has ended', async () => {
    const successor = objective('OBJECTIVE_STATE_WAITING', 'obj_2');
    const cadenya = fakeCadenya({
      retrieve: mock.fn(async () => objective('OBJECTIVE_STATE_TIMED_OUT')),
      list: mock.fn(async () => [successor]),
    });
    setCadenyaClient(cadenya);
    assert.strictEqual(await findThreadObjective(THREAD), successor);
    assert.strictEqual(
      cadenya.objectives.list.mock.calls[0].arguments[0].labels,
      'slack_channel=C123,slack_thread_ts=1.0',
    );
  });
});

describe('sendToThreadAgent', () => {
  /** @type {any} */
  let cadenya;

  beforeEach(() => {
    process.env.CADENYA_AGENT_ID = 'external_id:slack-agent';
    cadenya = fakeCadenya();
    setCadenyaClient(cadenya);
  });

  afterEach(() => setCadenyaClient(undefined));

  it('creates an objective keyed and labelled by the thread', async () => {
    await sendToThreadAgent(THREAD, 'hello', { messageTs: '1.0' });
    const params = cadenya.objectives.create.mock.calls[0].arguments[0];
    assert.strictEqual(params.agentId, 'external_id:slack-agent');
    assert.strictEqual(params.firstUserMessage, 'hello');
    assert.strictEqual(params.metadata.externalId, 'slack-T1-C123-1.0');
    assert.deepStrictEqual(params.metadata.labels, threadLabels(THREAD));
    assert.strictEqual(params.clientTools.definitions[0].name, 'add_emoji_reaction');
  });

  it('continues the objective the thread already has', async () => {
    await sendToThreadAgent(THREAD, 'and then?', { messageTs: '2.0', existing: objective('OBJECTIVE_STATE_RUNNING') });
    assert.deepStrictEqual(cadenya.objectives.continue.mock.calls[0].arguments, [
      'obj_1',
      { message: 'and then?', enqueue: true },
    ]);
    assert.strictEqual(cadenya.objectives.create.mock.callCount(), 0);
  });

  it('starts a successor with a new external ID when the objective has ended', async () => {
    await sendToThreadAgent(THREAD, 'back again', {
      messageTs: '9.0',
      existing: objective('OBJECTIVE_STATE_CANCELLED'),
    });
    assert.strictEqual(
      cadenya.objectives.create.mock.calls[0].arguments[0].metadata.externalId,
      'slack-T1-C123-1.0-9.0',
    );
  });

  it('treats a duplicate create as already handled, since Slack retries events', async () => {
    cadenya.objectives.create = mock.fn(async () => {
      throw new APIError(409, { message: 'resource with the same identifier already exists' });
    });
    await assert.doesNotReject(sendToThreadAgent(THREAD, 'hello', { messageTs: '1.0' }));
  });
});
