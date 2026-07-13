# Emma - 测试 CURRENT_CONTEXT

- 当前项目：TTool。
- 当前状态：available；最近完成「TTool 截图贴图普通截图完成自动复制」QA-lite，结果为 `stage_complete`。
- 当前任务：无 active QA；等待 PM 收口与后续 commit gate/用户验收安排。
- Pipeline/stage：ordinary capture auto-copy after capture / QA-lite -> PM terminal。
- Task Thread：019f3661-40ae-74a1-9374-b441e4ddfbf4 / 验证截图浮窗与标注。
- Worktree：`C:\Users\123\.codex\worktrees\fae0\tool` repaired user-facing non-Git partial snapshot。
- Completion callback：PM thread `019f220a-9067-7173-b2e6-743524ff2b22`，fallback `docs/codex/THREAD_EVENT_INBOX.md`。
- QA result：`stage_complete`；普通截图完成后剪贴板 readback 非空，右下角浮窗、toast 键盘、overlay fallback、auto-pin direct pin 和 SDK boundary 回归通过。
- Evidence summary：auto-copy clipboard smoke readback `1224x776`；实际 Electron app 普通截图 overlay 完成后 clipboard readback `189x126` 且 toast 出现。
- 注意事项：未对外部应用执行真实 Ctrl+V 粘贴；`C:\Users\123\.codex\worktrees\fae0\tool` 仍是非 Git partial snapshot，commit gate 需 PM 后续 reconcile。
