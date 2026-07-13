# API_SPEC

## 维护范围

本文件记录 TTool 的项目级 API/契约索引，不替代源码与对外指南。插件作者可执行契约以 `TTOOL-PLUGIN-GUIDE.md`、`PLUGINS.md`、`packages/sdk/src/index.ts` 和 `src/tools/types.ts` 为准。

## 当前契约入口

- 插件 SDK：`src/sdk/index.ts`
- npm SDK 包：`packages/sdk/src/index.ts`
- Plugin manifest 类型：`src/tools/types.ts`
- 插件加载器：`src/plugins/loader.ts`
- Electron 插件管理：`electron/plugins.cjs`
- Preload bridge：`electron/preload.cjs`

## 变更规则

- 同一 SDK 主版本内只增不改。
- 破坏性变更必须 bump `SDK_VERSION` 主版本，并更新指南迁移说明。
- 修改 external/globals、入口文件名、bridge 名称或 manifest 必须视为高风险，进入 Full Pipeline。

## 待补充

当新增稳定 API、IPC 契约、插件 manifest 字段或 SDK 方法时，在同一次任务中更新本文件索引。
