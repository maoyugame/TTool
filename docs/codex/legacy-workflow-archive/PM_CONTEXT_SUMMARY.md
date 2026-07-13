# PM_CONTEXT_SUMMARY

## Purpose

Legacy PM context recovery note. New task truth lives in each task record's Task State Projection, `TASK_OVERVIEW.md`, `CODEX_TASK_REGISTRY.md`, and `TASK_EVENT_INBOX.md`.

## Current State

- Project: TTool.
- Workflow entry: global `$t-workflow`.
- Current model: Task Graph / Task State Projection first; Task Thread is an optional container.
- Registry: `docs/codex/CODEX_TASK_REGISTRY.md` is index-only.
- Dashboard: `docs/codex/TASK_OVERVIEW.md`.
- Project context: `docs/codex/PROJECT_CONTEXT.md`.

## Active / Pending Summary

- Screenshot-pin work is the main active area.
- Several screenshot-pin tasks are accepted or pending user acceptance and still require scoped commit gate review.
- Commit gate must avoid staging unrelated org docs, generated release artifacts, or mixed untracked files by accident.
- The earlier non-Git partial snapshot risk remains historical context; current Git-backed checkout should be reconciled carefully before final staging.

## Recovery Order

1. Read `docs/codex/TASK_OVERVIEW.md`.
2. Read the matching task record under `docs/codex/tasks/*.md`.
3. Use `CODEX_TASK_REGISTRY.md` only as an index.
4. Check `TASK_EVENT_INBOX.md` for queued callbacks.
5. Fall back to this file only for legacy PM summary context.

## Last Migration

- 2026-07-07: Project workflow docs migrated toward current `$t-workflow` structure. Missing project metrics, metrics ledger, task overview, task event inbox, project context, batch directory, and task projections were added.
