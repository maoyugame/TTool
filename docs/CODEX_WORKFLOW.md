# CODEX_WORKFLOW

## 工作流总览

本文件说明 TTool 仓库内的文档入口与跨设备续接方式；全局 Codex 工作流规则由全局 `AGENTS.md` 与相应 skill 维护，不在本仓库复制。

## 开始工作

- 先阅读根目录 `AGENTS.md` 与 `CLAUDE.md`，了解项目约束、插件兼容性和验证要求。
- 产品、架构、API 与数据约束位于 `docs/` 根目录。
- 当前项目状态、任务索引和交接信息位于 `docs/codex/`。
- 在另一台设备继续工作前，先同步 Git，然后阅读 `docs/codex/PROJECT_CONTEXT.md`、`TASK_OVERVIEW.md` 与相关任务记录。

## 文档分层

- `docs/PRD.md`：产品需求与方向。
- `docs/ARCHITECTURE.md`、`API_SPEC.md`、`DB_SCHEMA.md`：技术契约与演进约束。
- `docs/DECISIONS.md`、`PROJECT_BRIEF.md`、`TASKS.md`：关键决策、项目摘要与待办。
- `docs/codex/PROJECT_CONTEXT.md`：当前项目上下文和风险。
- `docs/codex/CODEX_TASK_REGISTRY.md`、`TASK_OVERVIEW.md`、`TASK_EVENT_INBOX.md`：任务索引、看板和事件记录。
- `docs/codex/tasks/`、`batches/`、`design/`：任务、批次和设计过程记录。
- `docs/codex/legacy-workflow-archive/`：历史资料，仅供追溯，不作为当前执行依据。

## 版本管理边界

- 上述正式 Markdown 与代码一起提交，保证项目可以在另一台设备恢复上下文。
- 原始对话、运行日志、缓存、本机路径相关临时产物和未确认的草稿不进入版本库。
- `.codex/` 是本地 Codex 配置、日志与生成中间产物目录，已忽略；其中不应保存唯一的项目事实或决策。
