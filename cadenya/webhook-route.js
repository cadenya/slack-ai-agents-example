import { cadenya } from './client.js';
import { handleWebhookEvent } from './webhook-events.js';

export const WEBHOOK_PATH = '/webhooks/cadenya';

const MAX_REMEMBERED_DELIVERIES = 5000;

/**
 * Delivery IDs already handled, so a retried delivery is not posted twice.
 * In memory for the example: use a store with a unique constraint when you
 * run more than one process.
 * @type {Set<string>}
 */
const handledDeliveries = new Set();

/**
 * @param {string} deliveryId
 * @returns {void}
 */
function rememberDelivery(deliveryId) {
  handledDeliveries.add(deliveryId);
  if (handledDeliveries.size > MAX_REMEMBERED_DELIVERIES) {
    const oldest = handledDeliveries.values().next().value;
    if (oldest) handledDeliveries.delete(oldest);
  }
}

/**
 * Signature verification needs the exact bytes Cadenya sent.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string>}
 */
async function readRawBody(req) {
  const chunks = [];
  for await (const part of req) chunks.push(part);
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Build the Bolt custom route that receives Cadenya webhooks.
 * @param {() => import('./webhook-events.js').WebhookDeps} getDeps
 * @returns {import('@slack/bolt').CustomRoute}
 */
export function cadenyaWebhookRoute(getDeps) {
  return {
    path: WEBHOOK_PATH,
    method: ['POST'],
    handler: async (req, res) => {
      const deps = getDeps();
      const rawBody = await readRawBody(req);

      let event;
      try {
        event = await cadenya().webhooks.unwrap(rawBody, /** @type {any} */ (req.headers));
      } catch (e) {
        deps.logger.error(`Rejected Cadenya webhook: ${e}`);
        res.writeHead(401).end('bad signature');
        return;
      }

      const deliveryId = String(req.headers['webhook-id']);
      if (handledDeliveries.has(deliveryId)) {
        res.writeHead(200).end();
        return;
      }

      try {
        await handleWebhookEvent(event, deps);
        rememberDelivery(deliveryId);
        res.writeHead(200).end();
      } catch (e) {
        deps.logger.error(`Failed to handle Cadenya webhook ${event.type}: ${e}`);
        res.writeHead(500).end();
      }
    },
  };
}
