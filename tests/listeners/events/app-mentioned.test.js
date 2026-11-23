import assert from 'node:assert';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { setCadenyaClient } from '../../../cadenya/client.js';
import { handleAppMentioned } from '../../../listeners/events/app-mentioned.js';
import { fakeCadenya, objective } from '../../cadenya/fakes.js';

describe('handleAppMentioned', () => {
  /** @type {any} */
  let args;
  /** @type {any} */
  let cadenya;

  beforeEach(() => {
    process.env.CADENYA_AGENT_ID = 'external_id:slack-agent';
    cadenya = fakeCadenya();
    setCadenyaClient(cadenya);
    args = {
      context: { botUserId: 'UBOT', teamId: 'T1', userId: 'U456' },
      logger: { error: mock.fn() },
      say: mock.fn(async () => {}),
      setStatus: mock.fn(async () => {}),
    };
  });

  afterEach(() => setCadenyaClient(undefined));

  it('starts an objective for the thread with the mention stripped', async () => {
    const event = { channel: 'C123', text: '<@UBOT> what did you find?', ts: '3.0' };
    await handleAppMentioned({ ...args, event });
    const params = cadenya.objectives.create.mock.calls[0].arguments[0];
    assert.strictEqual(params.firstUserMessage, 'what did you find?');
    assert.strictEqual(params.metadata.externalId, 'slack-T1-C123-3.0');
  });

  it('continues the thread objective when a second person mentions the agent', async () => {
    cadenya.objectives.retrieve = mock.fn(async () => objective('OBJECTIVE_STATE_WAITING'));
    const event = { channel: 'C123', text: '<@UBOT> and this?', thread_ts: '1.0', ts: '3.0' };
    await handleAppMentioned({ ...args, event });
    assert.strictEqual(cadenya.objectives.continue.mock.calls[0].arguments[0], 'obj_1');
    assert.strictEqual(cadenya.objectives.create.mock.callCount(), 0);
  });

  it('greets without starting an objective when the mention has no text', async () => {
    const event = { channel: 'C123', text: '<@UBOT>', ts: '3.0' };
    await handleAppMentioned({ ...args, event });
    assert.strictEqual(args.say.mock.callCount(), 1);
    assert.strictEqual(cadenya.objectives.create.mock.callCount(), 0);
  });
});
