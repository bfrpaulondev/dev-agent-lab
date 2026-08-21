# AGENTS.md — DevAgent Lab

## Project purpose
This repository is a controlled laboratory for evaluating a DevAgent + ReviewerAgent pair before granting real repository, shell, cloud, or production permissions.

## Non-negotiable rules
- Never expose `GROQ_API_KEY` to browser code or tool results.
- The model may only operate on the in-memory virtual workspace exposed through allowlisted tools.
- No arbitrary shell command tool exists in this phase.
- No GitHub merge, production deployment, DNS, secrets, or database tools exist in this phase.
- ReviewerAgent is read-only and cannot mutate the workspace.
- Do not display hidden reasoning. UI may display tool actions, quality results, findings, and concise agent summaries only.
- Keep model IDs configurable via environment variables.
- A run must have deterministic safety bounds: request body limit, tool-turn limit, review-cycle limit, and workspace size limits.

## Quality
- Run `npm run check` before considering code changes complete.
- Any new tool requires input validation and a test proving it cannot escape the virtual workspace.
- Any new API route must remain same-origin by default and must not leak server exception details to the browser.
