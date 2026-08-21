# ForgePair — DevAgent + ReviewerAgent

ForgePair is a controlled coding-agent workspace powered by the OpenAI API. It keeps the in-memory sandbox and adds a guarded GitHub mode that can read an explicitly allowlisted repository, run DevAgent → ReviewerAgent, and open a pull request from an approved server-signed proposal.

## Default models

- DevAgent: `gpt-5.4-mini` with `reasoning=none` in controlled GitHub mode.
- ReviewerAgent: `gpt-5.4-mini` with `reasoning=none` in controlled GitHub mode.

Both defaults can be overridden with server-side environment variables. The production agent path uses the OpenAI Responses API and never exposes the API key to the browser.

## Execution modes

### Sandbox

- bounded in-memory text workspace;
- no shell or external writes;
- DevAgent implements, deterministic checks run, ReviewerAgent reviews, and findings can return to DevAgent for correction.

### Controlled GitHub mode

- requires operator authentication with `FORGEPAIR_ACCESS_KEY`;
- reads only repositories in `GITHUB_ALLOWED_REPOS`;
- selects a bounded task-relevant snapshot from the repository default branch;
- when a task explicitly names repository files, prioritizes those files and keeps extra context small;
- runs DevAgent and ReviewerAgent as two separate bounded serverless invocations;
- signs the DevAgent intermediate change set server-side before the Reviewer invocation;
- ReviewerAgent reloads the repository snapshot and requires the same base branch/tree SHA before reviewing the signed changes;
- blocks protected paths such as `.github/**`, `AGENTS.md`, environment/secrets, hosting and infra configuration;
- after approval, signs the exact proposed file changes server-side;
- only an intact, unexpired signed proposal can create one commit on a new `agent/...` branch and open a PR;
- re-checks the base branch SHA immediately before PR creation.

The browser coordinates the two HTTP calls after one **Executar tarefa** click, but it cannot modify the signed intermediate change set. If the base branch changes between DevAgent and ReviewerAgent, the run is rejected and must be started again.

The GitHub mode **cannot** write to `main`/the default branch, merge PRs, deploy, change DNS/hosting, run arbitrary shell commands, or access repository/cloud secrets.

## Required hosting environment variables

Configure these server-side on Vercel or Netlify:

```text
OPENAI_API_KEY=...
FORGEPAIR_ACCESS_KEY=...
GITHUB_AGENT_TOKEN=...
GITHUB_ALLOWED_REPOS=owner/repo,owner/second-repo
```

`FORGEPAIR_ACCESS_KEY` should be a long random value known only to the operator. The public page does not persist it: after you type it into the unlock field, it stays only in JavaScript memory for that page session and is sent in the `X-ForgePair-Access` header for agent actions.

Use a fine-grained GitHub token restricted to the repositories you want ForgePair to access. For PR creation it needs repository permissions for **Contents: Read and write** and **Pull requests: Read and write**. Do not grant administration, workflows, Actions secrets or organization-wide permissions.

Optional model/loop variables:

```text
DEV_MODEL=gpt-5.4-mini
REVIEW_MODEL=gpt-5.4-mini
MAX_REVIEW_CYCLES=2
MAX_COMPACT_REVIEW_CYCLES=2
```

Secrets are server-side only. `/api/config` exposes only readiness booleans/model names/provider metadata. The repository allowlist is returned only after the operator key is accepted.

## Portable API routes

The browser uses the same public API paths on both supported hosts:

- `GET /api/config`
- `GET /api/starter`
- `POST /api/run` — sandbox agent run
- `GET /api/github/repos` — authenticated allowlist discovery
- `POST /api/github/run` — authenticated repository snapshot + DevAgent stage
- `POST /api/github/review` — authenticated ReviewerAgent stage
- `POST /api/github/pr` — authenticated signed-proposal verification + branch/PR creation

Netlify maps these paths to `netlify/functions/*`. Vercel maps them through the `api/` adapters, which reuse the same guarded handlers.

### Vercel

The OpenAI execution functions reserve a 300-second maximum duration. Keep Fluid Compute enabled on the project and redeploy after changing environment variables. The static frontend stays in `public/`; OpenAI and GitHub secrets remain server-side.

### Netlify

The existing Netlify runtime remains supported. The split DevAgent/ReviewerAgent flow avoids placing both model requests inside one short-lived function invocation.

## Current GitHub-mode limits

The first authority level deliberately keeps repository context small to reduce model cost and avoid irrelevant context. It selects a small set of safe text files with deterministic file/workspace size bounds. It does not clone the repository or execute its real build/test scripts yet. The UI and PR body must not claim shell tests/builds/deploys were run.

Controlled GitHub mode currently performs one Dev stage followed by one independent Review stage per run. If ReviewerAgent requests changes, start a new run with the findings rather than performing an unbounded correction loop inside one serverless invocation.

The next authority level should use an isolated ephemeral runner for cloning and executing allowlisted test commands, while keeping merge/deploy/secrets outside the agent boundary.

## Cost and latency control

ForgePair uses bounded snapshots, compact plain-text envelopes, capped output tokens and low-latency reasoning settings. OpenAI usage is returned by the API for observability, while billing/credit remains controlled in the OpenAI project. If API credit is exhausted, ForgePair fails safely instead of falling back to another provider.

## Quality

```bash
npm run check
```

CI runs the same command on pull requests and pushes to `main`. Unit tests cover virtual-workspace safety, reviewer normalization, product-truthfulness gates, GitHub allowlisting, protected paths, proposal signing/tamper resistance, signed review-stage tamper resistance, OpenAI response parsing, latency bounds and Vercel adapter behavior.

## Local sandbox

```bash
npm start
```

Open `http://127.0.0.1:3000`.
