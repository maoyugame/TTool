# 文档导航

本目录保存随 TTool 代码同步的正式项目文档。它们用于恢复项目上下文、解释长期决策，并约束后续实现；请与相关代码改动一并提交。

## 项目与技术文档

- [PRD](PRD.md)：产品方向与需求。
- [ARCHITECTURE](ARCHITECTURE.md)：系统架构与关键约束。
- [API_SPEC](API_SPEC.md)：接口和运行时契约。
- [DB_SCHEMA](DB_SCHEMA.md)：数据模型约束。
- [DECISIONS](DECISIONS.md)：重要技术决策。
- [PROJECT_BRIEF](PROJECT_BRIEF.md)：项目摘要。
- [TASKS](TASKS.md)：待办与工作范围。

## Codex 项目记录

- [CODEX_WORKFLOW](CODEX_WORKFLOW.md)：文档分层与跨设备续接方式。
- [PROJECT_CONTEXT](codex/PROJECT_CONTEXT.md)：当前上下文、风险和约束。
- [TASK_OVERVIEW](codex/TASK_OVERVIEW.md)：任务看板。
- [CODEX_TASK_REGISTRY](codex/CODEX_TASK_REGISTRY.md)：任务记录索引。
- [TASK_EVENT_INBOX](codex/TASK_EVENT_INBOX.md)：任务事件记录。
- `codex/tasks/`、`codex/batches/`、`codex/design/`：任务、批次和设计记录。
- `codex/legacy-workflow-archive/`：仅供历史追溯的归档资料。

## 本地内容

`.codex/` 中的代理配置、运行日志与生成中间产物属于本机数据，已通过 `.gitignore` 排除。不要把唯一的需求、决策、交接信息或密钥保存在该目录。
