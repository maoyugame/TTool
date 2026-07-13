# ARCHITECTURE

## 架构概览

TTool 的核心应用位于 `src/`，Electron 桌面壳位于 `electron/`，插件 SDK 位于 `packages/sdk/`。项目目标是保持核心工具逻辑与运行时解耦，使 web、Electron 和未来可选运行时复用同一套核心代码。

## 主要模块

- `src/tools/`：内置工具类型、注册表、实现和共享 UI 原语。
- `src/plugins/`：外部插件渲染层加载器。
- `src/sdk/`：宿主注入的运行时 SDK。
- `src/platform/`：web / electron 平台适配层与快捷键。
- `src/store/`：外壳状态、持久状态与时间状态。
- `src/theme/` 与 `src/styles/tokens.css`：主题状态和设计令牌。
- `electron/`：主进程、preload、插件管理和桌面能力桥接。

## 关键约束

- 插件契约变更必须与 `TTOOL-PLUGIN-GUIDE.md`、`PLUGINS.md`、`packages/sdk/src/index.ts` 同步评估。
- SDK v1 期间只新增 API，不删除或改变既有 API 与行为。
- 插件加载路径安全、导航拦截和 bridge 边界不得削弱。
- 业务/组件层不直接调用 Electron API，必须走 `platform` 抽象。

## 验证入口

- 类型检查：`npm run typecheck`
- 生产构建：`npm run build`
- SSR 冒烟：`npm run smoke`
- Electron 开发：`npm run electron:dev`
