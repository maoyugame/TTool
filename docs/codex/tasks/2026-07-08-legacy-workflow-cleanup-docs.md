# 清理旧 workflow 规则副本

## Task State Projection

- task_id: 2026-07-08-legacy-workflow-cleanup-docs
- task_title: 清理旧 workflow 规则副本
- project_area: workflow
- status: completed
- graph_root_id: 2026-07-08-legacy-workflow-cleanup-root
- node_id: 2026-07-08-legacy-workflow-cleanup-docs
- owner: Docs worker
- progress: 活跃组织文档已收敛为项目事实、项目约束、任务记录、inbox/status 和指标证据；旧规则副本已非破坏归档。
- next_action: 上游复核最终 diff 与验证证据。
- updated: 2026-07-08

## Scope

- Inspected: `AGENTS.md`, `CLAUDE.md`, `docs/codex/**`, and referenced `$t-workflow` cleanup/acceptance guidance.
- Modified only documentation/workflow-record files under `AGENTS.md` and `docs/codex/**`.
- Business code, package manifests, lockfiles, assets, build/runtime config, and product docs outside `docs/codex/**` were not modified.

## Changes

- Archived legacy workflow-rule copies under `docs/codex/legacy-workflow-archive/`.
- Kept active records focused on project context, registry, overview, inbox, metrics, batches, design/task records, and short legacy pointers.
- Updated registry, task overview, project metrics aggregate, and this task record for closeout.

## Archive Map

- Top-level archived copies: routing, pipeline, worktree, acceptance, merge, handoff, home-thread, summary-template, PM summary, thread inbox, org chart, and agent registry files.
- Employee organization records: `docs/codex/legacy-workflow-archive/employees/`.
- Active compatibility pointers: `docs/codex/PM_CONTEXT_SUMMARY.md`, `docs/codex/THREAD_EVENT_INBOX.md`, and `docs/codex/employees/README.md`.

## Validation

- PASS `rg` active forbidden-rule scan over `AGENTS.md` and `docs/codex/**` excluding `legacy-workflow-archive/**` and task records: no matches.
- PASS `rg` active old-file-reference scan over non-archive, non-task active docs: no matches for archived protocol/template filenames.
- PASS cleanup record check: registry, task overview, and this task record contain `2026-07-08-legacy-workflow-cleanup-docs`.
- PASS archive preservation check: 48 files are preserved under `docs/codex/legacy-workflow-archive/`; sampled old routing file, employee task log, and active employee README all exist.
- PASS tracked diff scope check: `git diff --name-only` lists only pre-existing tracked business changes (`electron/main.cjs`, `package.json`, `src/components/SettingsPanel.tsx`); this docs cleanup did not modify tracked business code.
- Build/typecheck/smoke not run because this was docs-only and no business code/config was modified.

## Observability

- input_tokens: unknown
- output_tokens: unknown
- total_tokens: unknown
- wall_clock_ms: unknown
- worker_runtime_ms: unknown
- estimated_cost: unknown
- telemetry_status: unavailable

## Risks

- Archived originals still contain global workflow wording by design; scans for active docs should exclude `docs/codex/legacy-workflow-archive/**`.
- Historical task records may still mention old thread/pipeline terms as evidence; they were preserved rather than rewritten.
