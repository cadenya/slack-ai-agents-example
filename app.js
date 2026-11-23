import 'dotenv/config';

import { App, LogLevel } from '@slack/bolt';

import { cadenyaWebhookRoute, WEBHOOK_PATH } from './cadenya/webhook-route.js';
import { registerListeners } from './listeners/index.js';

const port = Number.parseInt(process.env.PORT || '3210', 10);

/** @type {App} */
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.INFO,
  ignoreSelf: false,
  customRoutes: [cadenyaWebhookRoute(() => ({ client: app.client, logger: app.logger }))],
  installerOptions: { port },
});

registerListeners(app);

(async () => {
  await app.start();
  app.logger.info(`Slack agent is running! Cadenya webhooks: http://localhost:${port}${WEBHOOK_PATH}`);
})();
