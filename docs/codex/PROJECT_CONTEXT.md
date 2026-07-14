# PROJECT_CONTEXT

This file records TTool project facts, active record locations, and project-specific constraints. Global workflow rules come from the `$t-workflow` Skill currently loaded by the Codex environment, not from a hard-coded filesystem path or a repository-local rule copy.

## Workflow Authority

- Storage mode: `shared`
- Workflow root: `docs/codex/`
- Generic workflow authority: the current environment's loaded global `$t-workflow` Skill
- Repository workflow documents do not redefine generic tiers, routing, Task Graph, state models, templates, or gates.
- `tasks/**`, `design/**`, compatibility pointers, and `legacy-workflow-archive/**` are evidence only. Historical absolute paths, commands, roles, and workflow names in those files are not current execution instructions.
- If a repository workflow record conflicts with the global `$t-workflow`, follow the global Skill; retain only TTool-specific facts and stricter project safety constraints from repository documents.

## Project Facts

- Product: TTool
- Type: cross-platform desktop utility platform with pluggable tool/plugin system
- Stack: Vite, React 19, TypeScript, Electron
- Key paths:
  - `src/`: core renderer app, tools, platform adapters, SDK surface
  - `electron/`: desktop main/preload and host bridge
  - `packages/sdk/`: external plugin SDK
  - `examples/hello-tool/`: example plugin
- Validation commands:
  - `npm run typecheck`
  - `npm run build`
  - `npm run smoke`

## Active Records

- Task records: `docs/codex/tasks/*.md`
- Registry index: `docs/codex/CODEX_TASK_REGISTRY.md`
- Dashboard: `docs/codex/TASK_OVERVIEW.md`
- Inbox: `docs/codex/TASK_EVENT_INBOX.md`
- Metrics: `docs/codex/PROJECT_METRICS.md` and `docs/codex/PROJECT_METRICS_LEDGER.md`
- Batch records: `docs/codex/batches/*.md`
- Legacy archive: `docs/codex/legacy-workflow-archive/`

## Active Goals

- Keep screenshot-pin user acceptance and commit gate recoverable from task records.
- Keep plugin SDK screenshot capability non-exposed to external plugin runtime.
- Reconcile any non-Git partial snapshot changes into a coherent Git-backed worktree before final commit.

## Current Blockers / Risks

- Historical task telemetry is unavailable; observability values are `unknown`.
- Several screenshot-pin tasks are accepted or pending user acceptance but still require scoped commit gate review.
- Existing worktree contains mixed business/docs/org changes and untracked files; do not stage broad directories blindly.

## Project Constraints

- Visual resources must use `imagegen` / built-in `image_gen`.
- High-risk Electron preload/main bridge and plugin SDK changes require typecheck/build/smoke plus SDK boundary review.
- Plugin contract changes must evaluate `TTOOL-PLUGIN-GUIDE.md`, `PLUGINS.md`, and `packages/sdk/src/index.ts` in the same scope.
- Do not stage broad directories blindly; current checkout may contain mixed user, docs, and generated changes.
