# ForgePair — DevAgent + ReviewerAgent Lab

Safe laboratory for evaluating a Groq-powered DevAgent + ReviewerAgent pair before granting real GitHub, shell, cloud, database, or production permissions.

The application runs a bounded virtual React/TypeScript workspace. DevAgent can inspect and edit that workspace, execute deterministic quality checks and inspect its diff. ReviewerAgent is read-only and independently reviews the task, diff and quality report. If changes are requested, verified findings are sent back to DevAgent for a correction cycle.

## Safety boundary

This version intentionally has no arbitrary shell, no GitHub writes from the agents, no merge, no production deploy, no database and no secret-management tools. Secrets are server-only and must be supplied through environment variables.

## Models

Defaults are configurable without changing source code:

- DevAgent: `qwen/qwen3.6-27b`
- ReviewerAgent: `openai/gpt-oss-120b`

## Run

Requirements: Node.js 22+.

```bash
cp .env.example .env.local
# set GROQ_API_KEY in .env.local
npm run check
npm start
```

Open `http://127.0.0.1:3000`.

`GROQ_API_KEY` is never sent to browser code and `.env` / `.env.local` are ignored by Git.

## Evaluation

The UI contains a first UI/UX task for the pair. See `docs/EVALUATION.md` for the progressive evaluation plan and `docs/ARCHITECTURE.md` for the security model.

## Quality

```bash
npm run check
```

The check command validates JavaScript syntax and runs the safety/unit test suite.
