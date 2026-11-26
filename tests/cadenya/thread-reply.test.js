import assert from 'node:assert';
import { describe, it, mock } from 'node:test';

import { ThreadReply } from '../../cadenya/thread-reply.js';
import { fakeSlack, SILENT_LOGGER, THREAD } from './fakes.js';

describe('ThreadReply', () => {
  it('opens no Slack message until there is something to show', async () => {
    const client = fakeSlack();
    const reply = new ThreadReply({ client, logger: SILENT_LOGGER }, THREAD);
    await reply.appendText('');
    await reply.finish();
    assert.strictEqual(client.chatStream.mock.callCount(), 0);
  });

  it('carries on in a new message once Slack has closed the stream', async () => {
    const client = fakeSlack();
    const reply = new ThreadReply({ client, logger: SILENT_LOGGER }, THREAD);
    await reply.appendText('one');
    client.streams[0].append = mock.fn(async () => {
      throw new Error('message_not_in_streaming_state');
    });
    await reply.appendText('two');
    assert.deepStrictEqual(client.streams[1].chunks, [{ type: 'markdown_text', text: 'two' }]);
  });

  it('starts a new message before text passes the stream limit', async () => {
    const client = fakeSlack();
    const reply = new ThreadReply({ client, logger: SILENT_LOGGER }, THREAD);
    await reply.appendText('a'.repeat(9000));
    await reply.appendText('b'.repeat(3000));
    assert.strictEqual(client.streams.length, 2);
    assert.deepStrictEqual(client.streams[0].stopped, {});
  });
});
