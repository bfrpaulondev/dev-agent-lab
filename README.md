# ForgePair — DevAgent + ReviewerAgent

ForgePair is a controlled coding-agent workspace powered by the OpenAI API. It keeps the in-memory sandbox and adds a guarded GitHub mode that can read an explicitly allowlisted repository, run DevAgent → ReviewerAgent, and open a pull request from an approved server-signed proposal.

## Default models

- DevAgent: `gpt-5.4-mini` with low reasoning — strong cost-sensitive coding/subagent model.
- ReviewerAgent: `gpt-5-mini` with low reasoning — independent lower-cost review.

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
- runs the same DevAgent → ReviewerAgent loop;
- blocks protected paths such as `.github/**`, `AGENTS.md`, environment/secrets, hosting and infra configuration;
- after approval, signs the exact proposed file changes server-side;
- only an intact, unexpired signed proposal can create one commit on a new `agent/...` branch and open a PR;
- re-checks the base branch SHA immediately before PR creation.

The GitHub mode **cannot** write to `main`/the default branch, merge PRs, deploy, change DNS/hosting, run arbitrary shell commands, or access repository/cloud secrets.

## Required hosting environment variables

Configure these as server-side environment variables in Vercel or Netlify:

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
REVIEW_MODEL=gpt-5-mini
MAX_REVIEW_CYCLES=2
MAX_COMPACT_REVIEW_CYCLES=2
```

Secrets are server-side only. `/api/config` exposes only readiness booleans/model names/provider metadata. The repository allowlist is returned only after the operator key is accepted.

## Vercel deployment

The `api/` directory adapts the existing guarded handlers to Vercel Functions while preserving the same browser API surface:

- `GET /api/config`
- `GET /api/starter`
- `POST /api/run`
- `GET /api/github/repos`
- `POST /api/github/run`
- `POST /api/github/pr`
- `GET /api/health`

The two OpenAI execution routes (`/api/run` and `/api/github/run`) reserve a 300-second Vercel Function duration so a DevAgent → ReviewerAgent run is not constrained by the previous 30-second Netlify execution observed in production. Keep Fluid Compute enabled for the Vercel project and redeploy after changing environment variables.

The static frontend remains in `public/`. No OpenAI or GitHub secret is embedded into static assets.

## Netlify deployment

The existing Netlify Functions remain supported through the original routes configured in `netlify.toml`, including `/health`, `/api/run` and the controlled GitHub endpoints.

## Current GitHub-mode limits

The first authority level deliberately keeps repository context small to reduce model cost and avoid irrelevant context. It selects a small set of safe text files with deterministic file/workspace size bounds. It does not clone the repository or execute its real build/test scripts yet. The UI and PR body must not claim shell tests/builds/deploys were run.

The next authority level should use an isolated ephemeral runner for cloning and executing allowlisted test commands, while keeping merge/deploy/secrets outside the agent boundary.

## Cost control

ForgePair intentionally uses bounded snapshots, compact plain-text envelopes, capped output tokens and at most two Dev → Reviewer cycles. OpenAI usage is returned by the API for observability, while billing/credit remains controlled in the OpenAI project. If API credit is exhausted, ForgePair fails safely instead of falling back to another provider.

## Quality

```bash
npm run check
```

CI runs the same command on pull requests and pushes to `main`. Unit tests cover virtual-workspace safety, reviewer normalization, product-truthfulness gates, GitHub allowlisting, protected paths, proposal signing/tamper resistance, OpenAI response parsing/rate-limit handling, and the Vercel adapter/runtime-duration contract.

## Local sandbox

```bash
npm start
```

Open `http://127.0.0.1:3000`. Production hosting can use either the existing Netlify Functions runtime or the Vercel `api/` adapters.
