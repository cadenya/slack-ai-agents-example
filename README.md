# Slack AI agent on Cadenya (Bolt for JavaScript)

An example Slack agent built with [Bolt for JavaScript](https://docs.slack.dev/tools/bolt-js/) whose brain is a [Cadenya](https://cadenya.com/docs) agent. Slack messages become Cadenya objectives through the [`@cadenya/cadenya`](https://www.npmjs.com/package/@cadenya/cadenya) SDK, and everything the agent does (replies, tool calls, approval requests, errors) comes back into the Slack thread through Cadenya webhooks.

**Read the guide: [Building a Slack agent](https://cadenya.com/docs/guides/building-a-slack-agent).**

The app keeps no database. The link between a Slack thread and a Cadenya objective lives on the objective itself, in its `externalId` and `labels`.

It started from Slack's [`bolt-js-starter-agent`](https://github.com/slack-samples/bolt-js-starter-agent) template.

## How it works

```
Slack thread ──message──▶ Bolt listener ──create / continue──▶ Cadenya objective
     ▲                                                               │
     └──── chat.postMessage ◀── webhook route ◀── signed webhook ────┘
```

1. **Slack → Cadenya.** A DM, an @mention, or a reply in a thread the agent is part of reaches a Bolt listener (`listeners/events`). The listener calls `sendToThreadAgent` (`cadenya/thread.js`), which creates an objective for the thread or continues the one it already has, then returns. It does not wait for the agent.
2. **Cadenya → Slack.** Cadenya POSTs each objective event to `/webhooks/cadenya` (`cadenya/webhook-route.js`). The route verifies the signature with `cadenya.webhooks.unwrap`, then `cadenya/webhook-events.js` reads the Slack thread out of the objective's labels and acts on the event.

### Storing data on the objective

| Stored as             | Value                                                                          | Used for                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metadata.externalId` | `slack-<team>-<channel>-<thread_ts>`                                           | Slack → Cadenya. Find a thread's objective with `objectives.retrieve('external_id:…')`. Also makes creation idempotent: Slack retries events, and a second create with the same external ID returns `409`.                   |
| `metadata.labels`     | `source=slack`, `slack_team`, `slack_channel`, `slack_thread_ts`, `slack_user` | Cadenya → Slack. Every webhook envelope carries the objective's labels, so the handler knows which thread to post in without a lookup. Also filterable: `objectives.list({ labels: 'slack_channel=C…,slack_thread_ts=…' })`. |

An external ID is never reusable, even after its objective ends. When someone writes in a thread whose objective has timed out or finished, the app starts a successor with the external ID `<thread id>-<message ts>` and finds it later with the label filter.

### What each webhook event does

Every event carries an `iterationId`. Events that share one belong together: an assistant message and the tool calls it asked for. The app opens one Slack message per iteration with [`chat.startStream`](https://docs.slack.dev/reference/methods/chat.startStream/) in `plan` mode, and each webhook appends a chunk to it with [`chat.appendStream`](https://docs.slack.dev/reference/methods/chat.appendStream/).

| Event                                                      | In Slack                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `objective_event.assistant_message`                        | Appends the text to the iteration's message. The final answer gets feedback buttons.                                                                                                                                           |
| `objective_event.tool_called`                              | Adds the call to the [plan](https://docs.slack.dev/reference/block-kit/blocks/plan-block/) as an in-progress task. A client tool defined by this app also runs, and its result goes back with `objectives.setToolCallContent`. |
| `objective_event.tool_result`, `tool_error`, `tool_denied` | Marks the task complete or failed. When the iteration's last call settles, the message closes.                                                                                                                                 |
| `objective_event.tool_approval_requested`                  | Shows the task as waiting for approval and posts Approve and Deny buttons. A click calls `objectives.approveToolCall` or `objectives.denyToolCall`.                                                                            |
| `objective_event.error`                                    | Posts the error in the thread.                                                                                                                                                                                                 |

A sub-agent's tool calls stay out of the plan, but its approval requests and errors reach the thread of the objective that started it. The feedback buttons call `objectives.createFeedback`, which feeds the agent's variation selection.

Webhooks carry whole messages. Text deltas are only on Cadenya's live event stream, so the reply arrives in one piece.

## Setup

The [Building a Slack agent](https://cadenya.com/docs/guides/building-a-slack-agent) guide walks through these steps and the code behind them.

### Prerequisites

You need:

- The [Slack CLI](https://docs.slack.dev/tools/slack-cli/). Log in with `slack login`.
- The Cadenya CLI. The next section installs it.
- Node.js 22 or later.
- A tunnel such as [ngrok](https://ngrok.com/download).

### Install the Cadenya CLI

Install the CLI with Homebrew:

```sh
brew install cadenya/tools/cadenya
```

The [CLI guide](https://cadenya.com/docs/guides/the-basics/cli#install-the-cli) lists the other install options. Then log in and choose a workspace:

```sh
cadenya auth login
cadenya workspaces list
cadenya config set workspace-id development
```

Replace `development` with the external ID of your workspace.

### 1. Clone

```sh
git clone https://github.com/cadenya/slack-ai-agents-example.git
cd slack-ai-agents-example
npm install
cp .env.sample .env
```

### 2. Create the Cadenya agent

Any published agent works. This one gets Cadenya's free Faker MCP server with approval required on every call, so you can see the approval buttons. Set `MODEL_ID` to a model from `cadenya models list`:

```sh
MODEL_ID=your-model-id

cadenya tool-sets create \
  --name "Faker MCP" \
  --external-id faker \
  --description "Generates fake names, addresses, and other sample data" \
  --adapter mcp \
  --mcp-url https://free.cadenya.com/faker-mcp \
  --mcp-tool-approvals always --mcp-tool-approvals-always

cadenya agents create \
  --name "Slack agent" \
  --external-id slack-agent \
  --description "Answers questions in Slack threads"

cadenya agents variations create external_id:slack-agent \
  --name Default \
  --external-id default \
  --model-id "$MODEL_ID" \
  --system-prompt-template "You answer questions in Slack threads. Keep replies short. Use the Faker tools for sample data, and never invent it yourself." \
  --assignment '{"type": "toolSetId", "toolSetId": "external_id:faker"}'

cadenya agents publish external_id:slack-agent
```

### 3. Point the agent's webhooks at your machine

Cadenya has to reach the webhook receiver on port `3210`. Start a tunnel, then set its URL on the agent, with the `/webhooks/cadenya` path:

```sh
ngrok http 3210

cadenya agents update external_id:slack-agent \
  --webhook-events-url https://your-tunnel.ngrok-free.dev/webhooks/cadenya
```

### 4. Fill in `.env`

| Variable                 | Value                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `CADENYA_API_KEY`        | An API key with the `objectives:manage` scope.                                                       |
| `CADENYA_WORKSPACE_ID`   | The workspace that owns the agent, from `cadenya workspaces list`.                                   |
| `CADENYA_AGENT_ID`       | The agent's ID, or `external_id:slack-agent`.                                                        |
| `CADENYA_WEBHOOK_SECRET` | The account's `whsec_…` signing key, from [Account Admin](https://app.cadenya.com/account/webhooks). |
| `PORT`                   | Optional. Port of the webhook receiver, `3210` by default.                                           |

Create the API key with the CLI. The token is in `spec.token` and is shown once:

```sh
cadenya api-keys create \
  --name "Slack agent" \
  --workspace-assignment workspace-id=your-workspace-id \
  --permission objectives:manage \
  --display json | jq -r '.spec.token'
```

`slack run` supplies `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN`. Set them yourself only when you start the app with `npm start`. If you use [direnv](https://direnv.net), the included `.envrc` loads `.env` into your shell.

### 5. Run

```sh
slack run
```

The first run creates the Slack app from `manifest.json` and installs it to the workspace you pick. The app runs in [Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/), so Slack needs no public URL.

Then DM the app or @mention it in a channel: "Can you generate me a fake name?"

## Project structure

- `app.js`: Starts Bolt in Socket Mode and mounts the Cadenya webhook route on Bolt's HTTP server.
- `cadenya/client.js`: The shared `@cadenya/cadenya` client.
- `cadenya/thread.js`: Maps a Slack thread to an objective: external ID, labels, find, create, continue.
- `cadenya/client-tools.js`: Tools the agent can call that this app executes.
- `cadenya/webhook-route.js`: Receives webhooks: raw body, signature check, deduplication on `webhook-id`.
- `cadenya/webhook-events.js`: Routes each webhook event to its Slack thread.
- `cadenya/thread-renderer.js`: Renders an objective's events as Slack messages, one per iteration, with a plan of tool calls.
- `cadenya/thread-reply.js`: One streaming Slack message: start, append chunks, stop.
- `cadenya/thread-actions.js`: Approval requests, client tool runs and error posts.
- `listeners/events`: Slack messages, @mentions and App Home.
- `listeners/actions`: Feedback buttons and tool approval buttons.
- `listeners/views`: Block Kit builders.

## Going to production

- Webhook deduplication and each iteration's open Slack message are in memory. With more than one process, store handled `webhook-id` values somewhere shared, with a unique constraint, and the stream's `ts` by `iterationId`.
- The app uses one bot token, so it serves one Slack workspace. For many workspaces, add Bolt's OAuth installation store and pick the token by the `slack_team` label.
- Host the webhook route on a stable public URL instead of a tunnel.

## Development

```sh
npm run lint
npm run check
npm test
```
