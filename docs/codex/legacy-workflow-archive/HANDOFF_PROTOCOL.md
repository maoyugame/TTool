# HANDOFF_PROTOCOL

## Purpose

交接用于员工暂停、退休、替换、任务转移或长期上下文迁移。交接必须保留任务状态、风险、验证结果和下一步动作。

## Handoff packet template

```md
### Handoff: <employee> -> <target>

- Reason:
- Active tasks:
- Recently completed tasks:
- Files / branches / worktrees:
- Decisions:
- Validation:
- Known risks:
- Required acknowledgement:
```

## Employee retirement / termination gate

- Employee termination, retirement, deletion, disabling, or archiving is blocked until handoff is completed.
- A handoff target must be specified before termination can proceed.
- If the user does not specify a handoff target, PM-mode / CEO-mode must pause and either ask the user or recommend candidate receiving agents for confirmation.
- A handoff packet must be generated.
- All active, in_review, blocked, pending, and recently completed tasks owned by the employee must be audited.
- Open tasks must be transferred to the handoff target or explicitly marked blocked with a reason.
- The receiving agent must acknowledge the handoff.
- Relevant registries must be updated:
  - AGENT_ROLE_REGISTRY.md
  - CODEX_TASK_REGISTRY.md
  - employee PROFILE.md / TASK_LOG.md / HANDOFF_NOTES.md
  - role / department TASKS.md when present
- The employee agent TOML must not be deleted or archived before handoff completion.
- The employee status must not be changed to retired until handoff is complete.
- This is a hard gate, not a suggestion.
