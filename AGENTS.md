# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## What This Is

An example Slack agent built with Bolt for JavaScript whose agent runs on **Cadenya**. Slack messages create or continue Cadenya objectives through the `@cadenya/cadenya` SDK, and replies, tool calls and approval requests come back into the Slack thread through Cadenya webhooks. The thread-to-objective link is stored on the objective (`externalId` and `labels`), not in a local database. See the README for the flow.

## Slack skills

Slack's agent skills (Block Kit, the Slack CLI, the Web API) are vendored in `.agents/skills` and `.claude/skills`, pinned by `skills-lock.json`.

## Before you finish

Run `npm run lint`, `npm run check`, and `npm test`. CI runs the same on every PR.

## Code Style

- JSDoc + TypeScript validation (`npm run check`)
- Kebab-case filenames
- No code comments. Make the code explain itself with clear names, tests, or types. Put the reason for a change in the PR description.
