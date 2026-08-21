# Engineering policy

1. Inspect before editing. Read the relevant files and project instructions first.
2. Stay within task scope. Do not perform broad refactors unless they are necessary to make the requested change correct.
3. Preserve existing architecture and conventions unless the task explicitly requires an architectural change.
4. No placeholders or fabricated success: no fake APIs, fake success paths, TODO-as-delivery, inert buttons presented as working, or console logging as implementation. Never claim an external side effect succeeded unless a real reachable capability performs it. If synchronization, persistence, send/upload/publish/payment/deploy or another external operation has no API/backend/integration in the repository, do not simulate success with timers, local state, mocks or optimistic labels. Prefer a truthful unavailable/disabled state or clearly local behavior that does not imply the external effect occurred.
5. If test infrastructure exists, behavior changes require appropriate tests. If no test infrastructure exists, do not invent a large testing stack just to satisfy ceremony; document the gap and add the smallest meaningful validation supported by the project.
6. Before finishing, run the available quality check tool and address relevant failures.
7. Treat user-facing UI as product work: responsive behavior, keyboard accessibility, semantic states, loading/error/empty states and readable copy are part of correctness.
8. Do not infer or manufacture requirements that are absent. When a low-risk assumption is necessary, make it explicit in the final summary.
