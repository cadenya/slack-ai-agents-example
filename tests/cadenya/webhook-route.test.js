import assert from 'node:assert';
import { createHmac, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { after, before, describe, it, mock } from 'node:test';
import Cadenya from '@cadenya/cadenya';

import { setCadenyaClient } from '../../cadenya/client.js';
import { cadenyaWebhookRoute } from '../../cadenya/webhook-route.js';

const SECRET_BYTES = randomBytes(24);
const SECRET = `whsec_${SECRET_BYTES.toString('base64')}`;

const BODY = JSON.stringify({
  type: 'objective_event.assistant_message',
  timestamp: new Date().toISOString(),
  data: {
    objective: { id: 'obj_1', labels: { slack_team: 'T1', slack_channel: 'C123', slack_thread_ts: '1.0' } },
    objectiveEvent: { data: { type: 'assistantMessage', assistantMessage: { content: 'Hi!', toolCalls: [] } } },
  },
});

/**
 * @param {string} id
 * @param {string} body
 * @returns {Record<string, string>}
 */
function signedHeaders(id, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', SECRET_BYTES).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` };
}

/**
 * @param {import('@slack/bolt').CustomRoute} route
 * @param {Record<string, string>} headers
 * @param {string} body
 * @returns {Promise<number>}
 */
async function deliver(route, headers, body) {
  const req = /** @type {any} */ (Readable.from([Buffer.from(body)]));
  req.headers = headers;
  let status = 0;
  const res = /** @type {any} */ ({
    writeHead(code) {
      status = code;
      return this;
    },
    end() {},
  });
  await route.handler(req, res);
  return status;
}

describe('cadenyaWebhookRoute', () => {
  const postMessage = mock.fn(async () => ({}));
  const deps = /** @type {any} */ ({
    client: { chat: { postMessage } },
    logger: { debug: mock.fn(), error: mock.fn() },
  });
  const route = cadenyaWebhookRoute(() => deps);

  before(() => setCadenyaClient(new Cadenya({ apiKey: 'test-key', webhookSecret: SECRET })));
  after(() => setCadenyaClient(undefined));

  it('rejects a delivery with a bad signature', async () => {
    const headers = { ...signedHeaders('msg_bad', BODY), 'webhook-signature': 'v1,AAAA' };
    assert.strictEqual(await deliver(route, headers, BODY), 401);
    assert.strictEqual(postMessage.mock.callCount(), 0);
  });

  it('handles a signed delivery once, even when Cadenya retries it', async () => {
    assert.strictEqual(await deliver(route, signedHeaders('msg_1', BODY), BODY), 200);
    assert.strictEqual(await deliver(route, signedHeaders('msg_1', BODY), BODY), 200);
    assert.strictEqual(postMessage.mock.callCount(), 1);
  });

  it('answers 500 so Cadenya retries when Slack is unavailable', async () => {
    postMessage.mock.mockImplementationOnce(async () => {
      throw new Error('slack is down');
    });
    assert.strictEqual(await deliver(route, signedHeaders('msg_2', BODY), BODY), 500);
    assert.strictEqual(await deliver(route, signedHeaders('msg_2', BODY), BODY), 200);
  });
});
