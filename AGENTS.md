# AGENTS.md — ForgePair controlled agent

## Project purpose
This repository evaluates and operates a DevAgent + ReviewerAgent pair with two execution modes:
- sandbox mode: bounded in-memory virtual workspace only;
- controlled GitHub mode: authenticated operator reads an explicitly allowlisted repository, produces reviewed changes, then creates an `agent/...` branch and pull request from a server-signed approved proposal.

## Non-negotiable rules
- Never expose `OPENAI_API_KEY`, `GITHUB_AGENT_TOKEN`, or `FORGEPAIR_ACCESS_KEY` to browser-visible configuration, model output, logs, audit text, diffs, or tool results.
- Agent actions must require `FORGEPAIR_ACCESS_KEY` whenever it is configured. Controlled GitHub actions must not run without operator access configured.
- GitHub repositories must be explicitly listed in `GITHUB_ALLOWED_REPOS`; do not expose that list before operator authentication.
- Never write directly to the default branch or `main`.
- Never merge pull requests.
- Never deploy, change hosting/DNS, mutate databases, or access cloud/production secrets.
- Never modify `.github/**`, CI/workflows, `AGENTS.md`, environment/credential files, hosting configuration, Terraform/infra, or other protected paths in controlled GitHub mode.
- ReviewerAgent is read-only and cannot mutate the workspace or GitHub.
- A GitHub PR may only be created from the exact server-signed proposal produced after an approved DevAgent → ReviewerAgent run.
- Before PR creation, re-check that the base branch SHA is unchanged. If it changed, require a fresh agent run.
- Do not display hidden reasoning. UI may display actions, quality results, findings, concise summaries, diffs and PR metadata only.
- Keep model IDs configurable via environment variables.
- Every run must have deterministic request, workspace, file-count, file-size and review-cycle limits.

## Model-provider boundary
- Production agent calls use the OpenAI Responses API with `OPENAI_API_KEY` server-side only.
- Default DevAgent model is `gpt-5.4-mini`; default ReviewerAgent model is `gpt-5-mini`.
- Do not silently fall back to another provider when OpenAI credit, quota, authentication, or rate limits fail.
- Keep output-token and review-cycle caps explicit to control spend.

## GitHub permission boundary
Controlled GitHub mode may:
- read repository metadata/tree/blob content from an allowlisted repository after operator authentication;
- create blobs/tree/one commit for approved changes;
- create one new `agent/...` branch;
- open a pull request targeting the unchanged default branch.

It may not:
- update or force-update existing protected/default refs;
- merge or close PRs;
- edit GitHub Actions/workflows;
- read or write secrets;
- execute arbitrary shell commands;
- claim tests/builds/deploys ran when only deterministic workspace checks ran.

## Quality
- Run `npm run check` before considering repository changes complete.
- Any new write capability requires input validation plus deterministic tests proving authentication, protected-path and default-branch boundaries cannot be bypassed.
- Any API route must remain same-origin by default and must not leak credentials or raw server exception details to the browser.
