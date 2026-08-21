# Groq context budgeting

Controlled GitHub mode keeps explicitly named-file tasks compact for Groq organizations with an 8K TPM ceiling.

When a task names repository files directly, ForgePair prioritizes those files and includes at most one additional project-context file. Tasks without explicit file names retain the normal ranked snapshot behavior.

This is a context-selection optimization only. It does not relax protected-path checks, unseen-existing-file protection, proposal signing, base-SHA verification, or the human-only merge boundary.
