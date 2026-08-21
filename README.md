# ForgePair — DevAgent + ReviewerAgent Lab

A safe first-stage laboratory for evaluating a Groq-powered coding agent pair before granting real GitHub, shell, cloud, or production permissions.

## What this MVP does

- DevAgent receives a task and operates on a bounded in-memory React/TypeScript workspace.
- DevAgent can list/read/search/write/delete virtual files, inspect a diff and run deterministic quality checks.
- ReviewerAgent is read-only and independently reviews the original task + diff + quality report.
- If ReviewerAgent requests changes, findings are sent back to DevAgent for a correction cycle.
- The browser shows an observable timeline of tool actions without exposing hidden reasoning.
- Final code, diff, findings, quality report and review score stay visible in the UI.

## Safety boundary in v0.1

This version intentionally has **no arbitrary shell**, **no GitHub writes**, **no merge**, **no production deploy**, **no database**, and **no secret-management tools**. It is designed to answer one question first: *does the Dev → Review → Fix loop behave well enough to deserve more authority?*

## Models

Defaults are configurable via environment variables:

- DevAgent: `qwen/qwen3.6-27b`
- ReviewerAgent: `openai/gpt-oss-120b`

No model name is spread through application logic; change it with `DEV_MODEL` / `REVIEW_MODEL`.

## Run locally

1. Copy `.env.example` to `.env.local`.
2. Put your Groq API key in `GROQ_API_KEY`.
3. Run:

```bash
npm start
```

4. Open `http://127.0.0.1:3000`. The server binds to `0.0.0.0` by default for container/hosting compatibility.

There are no runtime npm dependencies in v0.1; Node.js 22+ provides the HTTP server and `fetch` implementation.

## Suggested first evaluation task

Use the prefilled UI/UX task. It deliberately asks the DevAgent to redesign a primitive dashboard while preserving React/TypeScript, mobile support, accessibility and the no-new-dependency constraint. The ReviewerAgent should reject visual-only edits that introduce fixed desktop widths, inaccessible state communication, placeholder actions, or unnecessary dependencies.

## Quality

```bash
npm run check
```

This validates JavaScript syntax and runs safety/unit tests around the virtual workspace and reviewer normalization.

## Next authority level (only after evaluation)

If repeated runs are reliable, add GitHub tools in a second phase:

- read repository tree/files;
- create a feature branch;
- write commits to that feature branch;
- open a PR;
- read CI results/diff.

Keep `main` merge, force-push, production deploy, secrets, DNS and destructive resources physically absent from the agent tool registry until an explicit human approval layer exists.

## Docker

```bash
docker build -t forgepair .
docker run --rm -p 3000:3000 -e GROQ_API_KEY=your_key forgepair
```

Health check: `GET /health`.

## CI

GitHub Actions runs `npm run check` on pull requests and pushes to `main`. The Groq key is not required for CI because agent calls are not executed in the unit test suite.
