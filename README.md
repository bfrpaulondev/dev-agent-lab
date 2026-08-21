# ForgePair — DevAgent + ReviewerAgent

ForgePair is a controlled coding-agent workspace powered by Groq. It keeps the in-memory sandbox and adds a guarded GitHub mode that can read an explicitly allowlisted repository, run DevAgent → ReviewerAgent, and open a pull request from an approved server-signed proposal.

## Execution modes

### Sandbox

- bounded in-memory text workspace;
- no shell or external writes;
- DevAgent implements, deterministic checks run, ReviewerAgent reviews, and findings can return to DevAgent for correction.

### Controlled GitHub mode

- requires operator authentication with `FORGEPAIR_ACCESS_KEY`;
- reads only repositories in `GITHUB_ALLOWED_REPOS`;
- selects a bounded task-relevant snapshot from the repository default branch;
- runs the same DevAgent → ReviewerAgent loop;
- blocks protected paths such as `.github/**`, `AGENTS.md`, environment/secrets, hosting and infra configuration;
- after approval, signs the exact proposed file changes server-side;
- only an intact, unexpired signed proposal can create one commit on a new `agent/...` branch and open a PR;
- re-checks the base branch SHA immediately before PR creation.

The GitHub mode **cannot** write to `main`/the default branch, merge PRs, deploy, change DNS/hosting, run arbitrary shell commands, or access repository/cloud secrets.

## First controlled GitHub test

This first controlled GitHub test demonstrates that ForgePair creates changes only on `agent/...` branches, opens pull requests for human review, and never performs automatic merges or deployments. All modifications remain isolated until a human explicitly approves the pull request.

## Required Netlify environment variables

```text
GROQ_API_KEY=...
FORGEPAIR_ACCESS_KEY=...
GITHUB_AGENT_TOKEN=...
GITHUB_ALLOWED_REPOS=owner/repo,owner/second-repo
```

`FORGEPAIR_ACCESS_KEY` should be a long random value known only to the operator. The public page does not persist it: after you type it into the unlock field, it stays only in JavaScript memory for that page session and is sent in the `X-ForgePair-Access` header for agent actions.

Use a fine-grained GitHub token restricted to the repositories you want ForgePair to access. For PR creation it needs repository permissions for **Contents: Read and write** and **Pull requests: Read and write**. Do not grant administration, workflows, Actions secrets or organization-wide permissions.

Optional model/loop variables:

```text
DEV_MODEL=qwen/qwen3.6-27b
REVIEW_MODEL=openai/gpt-oss-120b
MAX_REVIEW_CYCLES=2
MAX_COMPACT_REVIEW_CYCLES=2
```

Secrets are server-side only. `/api/config` exposes only readiness booleans. The repository allowlist is returned only after the operator key is accepted.

## Netlify routes

- `GET /health`
- `GET /api/config`
- `GET /api/starter`
- `POST /api/run` — sandbox agent run; operator key is required when configured
- `GET /api/github/repos` — authenticated allowlist discovery
- `POST /api/github/run` — authenticated read of allowlisted repo + agent/reviewer run
- `POST /api/github/pr` — authenticated signed-proposal verification + branch/PR creation

## Current GitHub-mode limits

This first authority level deliberately keeps repository context small to fit the current Groq TPM budget. It selects a small set of safe text files with deterministic file/workspace size bounds. It does not clone the repository or execute its real build/test scripts yet. The UI and PR body must not claim shell tests/builds/deploys were run.

The next authority level should use an isolated ephemeral runner for cloning and executing allowlisted test commands, while keeping merge/deploy/secrets outside the agent boundary.

## Quality

```bash
npm run check
```

CI runs the same command on pull requests and pushes to `main`. Unit tests cover virtual-workspace safety, reviewer normalization, product-truthfulness gates, GitHub allowlisting, protected paths and proposal signing/tamper resistance.

## Local sandbox

```bash
npm start
```

Open `http://127.0.0.1:3000`. Local Node server support remains focused on the sandbox; the controlled GitHub write flow is implemented through the Netlify Functions runtime used in production.