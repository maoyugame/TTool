# TTool — 项目规范（CLAUDE.md，项目级）

> 本文件是 **TTool** 项目的工程规范，供在本仓库工作的 AI 遵循（非全局规则）。
> 仓库：`git@github.com:maoyugame/TTool.git`

## 项目简介

TTool 是跨平台桌面**多功能工具平台 + 可插拔工具插件系统**。
- 技术栈：Vite + React 18 + TypeScript（核心）+ Electron（桌面壳）。
- 两种工具：**内置工具**（编译期，随宿主打包，见 `TOOLS.md`）与**外部插件**（运行期，独立项目独立构建、从 GitHub/本地动态安装，见 `PLUGINS.md`）。
- 品牌命名：产品/应用 **TTool**；SDK 包 `@maoyugame/ttool-sdk`；运行时全局 `TToolSDK`；预加载桥 `window.ttool`；应用名/存储前缀 `ttool`。内部 React 名（`useToolbox`/`ToolboxProvider` 等）保持不变，不属品牌面。

## 目录速览

```
src/                核心应用（外壳/启动台/工具/store/平台适配/主题/SDK）
  sdk/              暴露给插件的运行时 SDK（installSdkGlobals 注入 window.TToolSDK）
  tools/            内置工具：types(含 PluginManifest)/registry/impl(glob 自动发现)
  plugins/          外部插件渲染层加载器（懒加载）
  platform/         平台适配层（web/electron，tauri 可扩展）+ shortcuts
electron/           主进程 main.cjs + preload.cjs + plugins.cjs（插件管理器）
packages/sdk/       @maoyugame/ttool-sdk 包（类型 + 运行时桥接）
examples/hello-tool 示例外部插件（脚手架参考实现）
scripts/            ssr-smoke / capture / seed-plugin（验证用）
TTOOL-PLUGIN-GUIDE.md  ★ 给 AI 的插件脚手架文档（放入插件项目即可让 AI 据此创建）
TOOLS.md / PLUGINS.md / README.md
```

## ★ 硬规范：插件文档与向下兼容（最重要）

**`TTOOL-PLUGIN-GUIDE.md` 是对外（插件作者/AI）的契约文档**——它会被复制进各插件项目，AI 仅凭它创建插件。因此：

1. **改动以下任一处，必须在同一次改动里评估并同步更新 `TTOOL-PLUGIN-GUIDE.md`**（以及 `PLUGINS.md`、`packages/sdk/src/index.ts`）：
   - SDK 表面：`src/sdk/index.ts` 的 `TToolSDK` 导出（新增/改名/改签名）、`SDK_VERSION`。
   - manifest 规范：`src/tools/types.ts` 的 `PluginManifest`（字段增删改）。
   - 加载/安装机制：`src/plugins/loader.ts`、`src/tools/registry.ts`（注册/懒加载）、`electron/plugins.cjs`（安装/校验）、`electron/preload.cjs`（桥接）。
   - 构建契约：external/globals 全局名（`React`/`ReactDOM`/`ReactJsxRuntime`/`TToolSDK`）、入口文件名 `tool.js`。
   - 指南内嵌的脚手架（package.json/vite.config/tsconfig/manifest/`types/ttool-sdk.d.ts`/src 模板）必须与真实实现保持一致。
   - 同步后核对：指南的「§3 脚手架」「§4 SDK API」「§6 manifest」「§9 版本」与代码现状逐项一致。

2. **向下兼容（强制评估）**：
   - **同一 SDK 主版本内只增不改**：v1 期间 `TToolSDK` 只新增 API、不删除/不改变既有 API 与行为；`PluginManifest` 只增可选字段。据此保证已发布插件在后续 v1.x 宿主上持续可用。
   - **破坏性变更必须升主版本**：bump `src/sdk/index.ts` 的 `SDK_VERSION`（如 `'1'`→`'2'`），宿主 `src/plugins/loader.ts` 已按 `manifest.sdk` 主版本校验并拒绝不兼容插件——升级时必须保留这条拒绝/提示，并在指南 §9 写明迁移说明。
   - **改全局名 / 桥接名 / external 映射属破坏性**：会让既有插件 bundle 失效，需谨慎；如确需，同步改全部引用 + 升主版本 + 更新指南。
   - 任何改动都先问：**已发布的旧插件还能加载运行吗？** 不能 → 走主版本升级路径，不要静默破坏。

3. 路径安全等加固（`safeId`/`safeJoin`/导航拦截）是底线，改动插件加载相关代码时不得削弱。

4. **`@maoyugame/ttool-sdk` 发布在 npm 公共 registry**（源码 `packages/sdk/`，`prepublishOnly` 编译 dist）。SDK 表面变更后：bump `packages/sdk/package.json` 版本（破坏性变更同时 bump `SDK_VERSION` 主版本）→ `cd packages/sdk && npm publish --access public`（需维护者 npm 账号）→ 同步 `TTOOL-PLUGIN-GUIDE.md`。`packages/sdk/src/index.ts` 的类型必须与指南 §4 及 §11 兜底 shim 三处一致。

## 文档职责

| 文件 | 面向 | 内容 |
| --- | --- | --- |
| `README.md` | 总览 | 项目介绍、运行、两种扩展方式 |
| `TOOLS.md` | 内置工具作者 | 编译期工具（glob 自动发现）开发 |
| `PLUGINS.md` | 平台使用者 | 外部插件系统总览、安装、SDK API |
| `TTOOL-PLUGIN-GUIDE.md` | 插件项目里的 AI | 自包含脚手架 + 规范，创建合规插件 |
| `CLAUDE.md`（本文件） | 本仓库的 AI | 工程规范，尤其上面的文档维护与兼容规范 |

## 验证命令（交付前）

- `npm run typecheck` — 严格类型检查
- `npm run build` — 生产构建（glob 会打包全部内置工具）
- `npm run smoke` — 无浏览器 SSR 渲染冒烟（外壳 + 内置工具）
- `npm run electron` — 桌面端运行；`scripts/capture.cjs` 可进程内截图验收
- 改动插件链路后，务必重建 `examples/hello-tool` 并本地安装实测一遍

## 一般约定

- 中文交流与注释；技术标识符保留英文。
- 配色一律用 CSS 变量（深/浅色自适应），勿硬编码颜色。
- 桌面能力只走 `platform` 适配层，不在业务/组件层直接调用 electron。
- 第三方协议接入前先查官方文档，端到端真实验证后再交付。
