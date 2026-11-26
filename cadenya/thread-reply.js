/** @typedef {import('./thread.js').SlackThread} SlackThread */
/** @typedef {import('@slack/types').TaskUpdateChunk} TaskUpdateChunk */
/** @typedef {import('@slack/types').AnyChunk} AnyChunk */

/**
 * @typedef {Object} ReplyDeps
 * @property {import('@slack/web-api').WebClient} client
 * @property {Pick<import('@slack/logger').Logger, 'debug' | 'error'>} logger
 */

const MAX_STREAM_TEXT_CHARS = 11000;

/**
 * One streaming Slack message in a thread, appended to as events arrive: text
 * as markdown, tool calls as tasks in a plan. Slack closes a stream after ten
 * minutes and caps its text, so a reply that outlives either limit carries on
 * in a new message.
 */
export class ThreadReply {
  /** @type {import('@slack/web-api').ChatStreamer | undefined} */
  #streamer;
  #streamedChars = 0;
  #deps;
  #thread;

  /**
   * @param {ReplyDeps} deps
   * @param {SlackThread} thread
   */
  constructor(deps, thread) {
    this.#deps = deps;
    this.#thread = thread;
  }

  /**
   * @param {string} text
   * @returns {Promise<void>}
   */
  async appendText(text) {
    if (!text) return;
    if (this.#streamedChars + text.length > MAX_STREAM_TEXT_CHARS) await this.finish();
    this.#streamedChars += text.length;
    await this.#append([{ type: 'markdown_text', text }]);
  }

  /**
   * @param {Omit<TaskUpdateChunk, 'type'>} task
   * @returns {Promise<void>}
   */
  async updateTask(task) {
    await this.#append([{ type: 'task_update', ...task }]);
  }

  /**
   * @param {string} title
   * @returns {Promise<void>}
   */
  async setPlanTitle(title) {
    await this.#append([{ type: 'plan_update', title }]);
  }

  /**
   * Close the message. Blocks render under everything streamed so far.
   * @param {{ blocks?: import('@slack/types').AnyBlock[] }} [options]
   * @returns {Promise<void>}
   */
  async finish({ blocks } = {}) {
    const streamer = this.#streamer;
    this.#streamer = undefined;
    this.#streamedChars = 0;
    if (!streamer) return;
    try {
      await streamer.stop(blocks ? { blocks } : undefined);
    } catch (e) {
      this.#deps.logger.debug(`Could not stop the Slack stream: ${e}`);
    }
  }

  /**
   * @param {AnyChunk[]} chunks
   * @returns {Promise<void>}
   */
  async #append(chunks) {
    try {
      await this.#open().append({ chunks });
    } catch (e) {
      this.#deps.logger.debug(`Slack stream closed (${e}), continuing in a new message`);
      this.#streamer = undefined;
      await this.#open().append({ chunks });
    }
  }

  /** @returns {import('@slack/web-api').ChatStreamer} */
  #open() {
    this.#streamer ??= this.#deps.client.chatStream({
      channel: this.#thread.channelId,
      thread_ts: this.#thread.threadTs,
      recipient_team_id: this.#thread.teamId,
      recipient_user_id: this.#thread.userId,
      task_display_mode: 'plan',
    });
    return this.#streamer;
  }
}
