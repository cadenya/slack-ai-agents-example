import { mock } from 'node:test';
import { APIError } from '@cadenya/cadenya';

export const THREAD = { teamId: 'T1', channelId: 'C123', threadTs: '1.0', userId: 'U123' };

/**
 * @param {string} state
 * @param {string} [id]
 * @returns {any}
 */
export function objective(state, id = 'obj_1') {
  return { metadata: { id }, state };
}

/**
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
export function fakeCadenya(overrides = {}) {
  return {
    objectives: {
      retrieve: mock.fn(async () => {
        throw new APIError(404, { message: 'not found' });
      }),
      list: mock.fn(async () => []),
      create: mock.fn(async () => objective('OBJECTIVE_STATE_PENDING')),
      continue: mock.fn(async () => ({ type: 'event' })),
      setToolCallContent: mock.fn(async () => ({})),
      createFeedback: mock.fn(async () => ({})),
      approveToolCall: mock.fn(async () => ({})),
      denyToolCall: mock.fn(async () => ({})),
      ...overrides,
    },
  };
}
