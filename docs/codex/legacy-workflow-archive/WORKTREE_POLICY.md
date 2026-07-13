# WORKTREE_POLICY

## Default

Worktree 是 Graph Node / 可选 Task Thread 容器的例外隔离目录，不是执行模式。不得写 `Execution mode: worktree`。

## Codex App managed worktree

- 默认使用 Codex App managed worktree。
- starting branch 优先使用用户指定分支，否则使用当前项目 local checkout 分支。
- 不得默认从 `master` 或 `main` 创建。
- Codex App managed worktree 位置由 Codex 管理，当前不能自定义；必须记录实际路径。
- 如果选择带本地未提交变更的分支，必须验证 Codex App 是否把这些改动应用到了 managed worktree。

## Manual worktree

只有用户明确批准 `manual-approved` 时，才允许手动 Git worktree，并且必须记录精确路径。

## Required task-record fields

- worktree_kind
- base_branch
- base_commit
- branch
- actual_worktree_path

## Worker permission rule

创建可选容器 / worktree 前必须确认执行面能非交互执行。任务 prompt 必须包含：`Worker must not enter an approval loop. If any command prompts for approval, stop immediately, report the command and effective permission context, and wait for workflow/config repair.`

不得在 loaded configs 中同时出现 `default_permissions` 和 `sandbox_mode`。
