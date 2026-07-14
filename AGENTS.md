# TTool 项目级 AGENTS.md

本文件只记录 TTool 仓库的项目事实与覆盖项。通用 Codex 组织化流程以当前 Codex 环境实际加载的全局 `$t-workflow` Skill 为执行依据；不得写死用户目录或 Skill 安装路径，也不要把全局 workflow 全文复制进本项目。

## Workflow 规范来源

- 本项目不在仓库内重定义通用 workflow 的 tier、路由、Task Graph、状态模型、模板或门禁；这些内容始终由当前加载的全局 `$t-workflow` 提供。
- 项目文档只能补充 TTool 的项目事实、存储位置、领域约束、验证命令和更严格的安全要求。若项目 workflow 文档与全局 `$t-workflow` 冲突，以全局 Skill 为准。
- `docs/codex/tasks/**`、`docs/codex/design/**`、兼容指针及 `docs/codex/legacy-workflow-archive/**` 都是历史证据，不是执行规范；其中记录的旧绝对路径、命令、角色或 workflow 名称不得作为当前指令执行。

## 项目事实

- 产品名：TTool。
- 类型：跨平台桌面多功能工具平台 + 可插拔工具插件系统。
- 技术栈：Vite + React 19 + TypeScript + Electron。
- 关键目录：`src/` 核心应用，`electron/` 桌面壳，`packages/sdk/` 插件 SDK，`examples/hello-tool/` 示例插件。
- 既有项目规范：优先阅读并遵守 `CLAUDE.md`，尤其是插件文档同步、SDK 主版本兼容、路径安全和验证命令要求。

## Codex 记录位置

- 存储模式为 `shared`，workflow 根目录为 `docs/codex/`。
- 本项目使用当前环境加载的全局 `$t-workflow`；项目文档只记录 TTool 事实、约束、任务记录和指标证据。
- 活跃记录位于 `docs/codex/PROJECT_CONTEXT.md`、`CODEX_TASK_REGISTRY.md`、`TASK_OVERVIEW.md`、`TASK_EVENT_INBOX.md`、`PROJECT_METRICS*.md`、`tasks/**` 和 `batches/**`。
- 旧 workflow 规则、模板、协议和员工组织副本已归档到 `docs/codex/legacy-workflow-archive/`，不作为当前执行依据。

## TTool 高风险改动

- 修改插件链路、SDK 表面、manifest、加载/安装机制、Electron preload/main bridge、external/globals 映射时，必须同步评估 `TTOOL-PLUGIN-GUIDE.md`、`PLUGINS.md`、`packages/sdk/src/index.ts`。
- 同一 SDK 主版本内只增不改；破坏性变更必须升主版本并提供迁移说明。
- 不得削弱插件路径安全、导航拦截、`safeId` / `safeJoin` 等安全边界。
- 桌面能力只能通过 `platform` 适配层，不在业务组件层直接调用 Electron API。

## 验证与交付

- 常用检查：`npm run typecheck`、`npm run build`、`npm run smoke`。
- 改动插件链路后，按 `CLAUDE.md` 要求重建并本地安装 `examples/hello-tool` 实测。
