# Architecture — ForgePair v0.1

## Trust boundary

```text
Browser UI
  |
  | same-origin POST /api/run
  v
Node orchestrator (owns GROQ_API_KEY)
  |
  +--> DevAgent (Groq)
  |      |
  |      +--> allowlisted local tools
  |              list/read/search/write/delete virtual files
  |              quality checks
  |              diff
  |
  +--> ReviewerAgent (Groq, read-only)
         |
         +--> task + diff + quality report
         +--> approve / changes_requested JSON
```

The model never receives an unrestricted shell, filesystem path, GitHub token or cloud token.

## Why virtual workspace first

Before granting repository authority, we want evidence for:

1. Does DevAgent inspect before editing?
2. Does it obey explicit constraints?
3. Does it avoid placeholders and fake functionality?
4. Does ReviewerAgent find meaningful defects rather than style nitpicks?
5. Does DevAgent respond correctly to review feedback?
6. How many cycles/tokens are typically needed?

Only after repeated success should we add feature-branch GitHub tools.

## Safety controls

- Max request body: 750 KB.
- Max task: 6000 characters.
- Max workspace: 80 files / 600 KB total / 80 KB per file.
- No absolute/traversal/.git paths.
- Obvious private-key/GitHub/Groq secret-like material rejected from virtual file writes.
- Dev tool-turn limit.
- Review cycle limit.
- Per-IP in-memory run rate limit.
- Reviewer cannot mutate workspace.
- Browser never receives Groq key.
- No hidden reasoning is rendered.

## Phase 2 proposal

After evaluation, add a GitHub adapter with GREEN-only permissions:

- list/read/search repository;
- create `agent/...` branch from explicit base SHA;
- update files on that branch;
- create commits;
- open draft PR;
- read PR diff and CI.

Still physically omit:

- merge to main;
- force-push;
- production deploy;
- secrets/environment mutation;
- destructive cloud/database operations.
