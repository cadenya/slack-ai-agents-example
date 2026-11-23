import assert from 'node:assert';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { setCadenyaClient } from '../../../cadenya/client.js';
import { handleMessage } from '../../../listeners/events/message.js';
import { fakeCadenya, objective } from '../../cadenya/fakes.js';

describe('handleMessage', () => {
  /** @type {any} */
  let args;
  /** @type {any} */
  let cadenya;

  beforeEach(() => {
    process.env.CADENYA_AGENT_ID = 'external_id:slack-agent';
    cadenya = fakeCadenya();
    setCadenyaClient(cadenya);
    args = {
      context: { botUserId: 'UBOT', teamId: 'T1', userId: 'U123' },
      logger: { error: mock.fn() },
      say: mock.fn(async () => {}),
      setStatus: mock.fn(async () => {}),
    };
  });

  afterEach(() => setCadenyaClient(undefined));

  it('continues the objective of a thread the agent is part of', async () => {
    cadenya.objectives.retrieve = mock.fn(async () => objective('OBJECTIVE_STATE_WAITING'));
    const event = { channel: 'C123', channel_type: 'channel', text: 'and then?', thread_ts: '1.0', ts: '2.0' };
    await handleMessage({ ...args, event });
    assert.strictEqual(args.setStatus.mock.callCount(), 1);
    assert.strictEqual(cadenya.objectives.continue.mock.calls[0].arguments[1].message, 'and then?');
  });

  it('skips a thread reply in a thread the agent was never part of', async () => {
    const event = { channel: 'C123', channel_type: 'channel', text: 'lunch?', thread_ts: '1.0', ts: '2.0' };
    await handleMessage({ ...args, event });
    assert.strictEqual(args.setStatus.mock.callCount(), 0);
    assert.strictEqual(cadenya.objectives.create.mock.callCount(), 0);
  });

  it('skips a thread reply that mentions the agent, which app_mention answers', async () => {
    const event = { channel: 'C123', channel_type: 'channel', text: '<@UBOT> and then?', thread_ts: '1.0', ts: '2.0' };
    await handleMessage({ ...args, event });
    assert.strictEqual(cadenya.objectives.retrieve.mock.callCount(), 0);
  });

  it('starts an objective for a new DM, even one that mentions the agent', async () => {
    const event = { channel: 'D123', channel_type: 'im', text: '<@UBOT> help', ts: '3.0' };
    await handleMessage({ ...args, event });
    const params = cadenya.objectives.create.mock.calls[0].arguments[0];
    assert.strictEqual(params.metadata.externalId, 'slack-T1-D123-3.0');
    assert.strictEqual(params.metadata.labels.slack_user, 'U123');
  });

  it('skips top-level channel messages, which need a mention', async () => {
    const event = { channel: 'C123', channel_type: 'channel', text: 'hello all', ts: '4.0' };
    await handleMessage({ ...args, event });
    assert.strictEqual(cadenya.objectives.retrieve.mock.callCount(), 0);
  });
});
