# HOME_THREAD_PROTOCOL

## Purpose

PM Home Thread 是用户面对的协调入口。Employee Home Thread 只是 legacy 可选索引 / debug surface，不是默认创建对象，也不是任务状态源。

员工状态、当前任务、近期结果、能力摘要和交接信息的默认事实源是：

- `docs/codex/AGENT_ROLE_REGISTRY.md`
- `docs/codex/CODEX_TASK_REGISTRY.md`
- `docs/codex/employees/*/PROFILE.md`
- `docs/codex/employees/*/TASK_LOG.md`
- `docs/codex/employees/*/CURRENT_CONTEXT.md`
- `docs/codex/employees/*/CAPABILITY_SUMMARY.md`

## Home threads

| 显示名 | thread id | 状态 |
| --- | --- | --- |
| PM - 项目经理 | 019f220a-9067-7173-b2e6-743524ff2b22 | created-unpinned |
| Sophia - 产品 | 019f220a-aab3-7ce1-8997-64f187942522 | optional-existing-index |
| Mia - UI美术 | 019f220a-b947-74d1-92c3-9277a9097a7f | optional-existing-index |
| Noah - 美术素材 | 019f220a-c827-7133-a125-4e4947ca5ae7 | optional-existing-index |
| Alex - 研发 | 019f220a-dbce-7e83-9a7b-a6d4f21611f6 | optional-existing-index |
| Emma - 测试 | 019f220a-e729-71e2-9ad7-5e78dd7d4f7d | optional-existing-index |
| Olivia - 文档 | 019f220a-f1f9-7983-88f5-ee37762cb252 | optional-existing-index |

## Dispatch requirements

- 具体实现任务默认建模为 Task Graph / Graph Node；只有隔离、并行、安全或上下文价值明确时才使用 scoped Task Thread 容器。
- 新建可选 Task Thread 容器标题使用 `<短任务标题>-<员工英文名>-<职称>`，例如 `新增登录功能-Sophia-产品`。
- Employee Home Thread 缺失不是异常；不得因为缺少它而阻断派发。
- 若发送到可选 Employee Home Thread，消息必须说明这是索引/摘要更新，还是要求其创建/指向 Task Thread。
- Home Thread 索引/回填记录必须包含目标 id/title、动作、结果和是否需要用户决策；不得当作具体任务已派发。

## Employee list command

查看员工列表使用：

```text
Use $t-workflow. 查看员工列表。
Use $t-workflow. 选择员工查看近期任务和能力摘要。
```

如果当前 Codex surface 支持结构化选择 UI，应优先弹出员工选择；否则输出编号列表并接受编号、员工名或 role_tag。
