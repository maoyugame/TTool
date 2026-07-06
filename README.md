# TTool

一个**跨平台桌面多功能工具集**：macOS 毛玻璃质感、「指挥官」风格启动台 + 标签工作区。工具在标签页里真实运行（即时翻译 / JSON 格式化 / Unix 时间戳），并支持中文拼音搜索、第三方应用快速启动、分类筛选、最近使用、深 / 浅色切换、全局热键唤醒、平台感知键盘快捷键、设置面板。

> 本项目按 [Claude Design](https://claude.ai/design) 导出的设计稿实现（设计稿原型见 `design-reference/`，不纳入版本库）。最终采用「方向 A · 指挥官」：居中命令栏 + 工具列表，标签工作区。

## 设计取向：从第一天起「做好兼容」

这是TTool项目的**设计初期**，架构的首要目标是**兼容与可扩展**，体现在三根支柱：

### 1. 工具插件注册表（横向扩展工具）

新增一个工具 = **新建一个文件 + 注册一行**，外壳 / 启动台 / 标签栏**零改动**。

- 契约：`src/tools/types.ts` 的 `ToolPlugin`（`id / name / desc / glyph / cat / hue / component`）。
- 注册表：`src/tools/registry.ts`（注册、查询、分类筛选、搜索；注册顺序即展示顺序）。
- 每个工具是 `src/tools/impl/<id>.tsx` 中一个自包含组件，文件内调用 `registerTool({...})`。
- 分类筛选项由注册表**自动派生**（`全部 + 实际存在的分类 + 应用`），加新分类无需改 UI。

### 2. 平台适配层（纵向兼容运行时）

业务 / 工具代码**只依赖抽象接口** `src/platform/types.ts` 的 `Platform`，从不直接调用 Electron / Tauri / 浏览器 API。同一套核心应用因此可在多种运行时**零改动**运行：

| 运行时 | 适配器 | 能力 |
| --- | --- | --- |
| **web**（默认） | `src/platform/web.ts` | 浏览器即开即用；剪贴板；无桌面能力处优雅降级 |
| **electron** | `src/platform/electron.ts` | 原生剪贴板、启动第三方应用、文件选择、窗口控制 |
| **tauri**（预留） | 新增 `src/platform/tauri.ts` 实现同一接口即可 | —— 核心代码无需改动 |

运行时探测在 `src/platform/index.ts`：检测到 `window.toolbox`（Electron 预加载注入）→ 用 electron 适配器，否则回退 web。

### 3. 主题系统

设计令牌（深 / 浅色全套 CSS 变量）逐字移植自设计稿，集中在 `src/styles/tokens.css`，作用域 `.tb[data-theme]`；所有组件只消费 `var(--xxx)`。切换在 `src/theme/ThemeContext.tsx`，并持久化到 `localStorage`。

## 技术栈

- **核心**：Vite + React 18 + TypeScript（框架无关的 UI 与工具逻辑）
- **桌面壳**：Electron（无边框 + 各平台毛玻璃质感 + IPC 桥接桌面能力）
- 无第三方 UI 库；样式以内联 style + 设计令牌还原设计稿。

## 目录结构

```
electron/                Electron 主进程与预加载（桌面壳，可选）
  main.cjs               创建毛玻璃窗口、IPC：剪贴板/打开应用/文件选择/窗口控制
  preload.cjs            contextBridge 暴露受控的 window.toolbox
src/
  main.tsx               React 入口
  App.tsx                外壳装配 + 内容区路由
  styles/tokens.css      设计令牌（深/浅色变量）+ keyframes + 悬停工具类
  theme/ThemeContext.tsx 主题状态与切换
  platform/              平台适配层（types / web / electron / index）
  store/
    toolbox.tsx          外壳状态（视图/标签/最近使用/Toast/复制）
    persistentState.ts   工具输入跨标签切换保活
    useNow.ts            每秒时钟（时间戳/时区共用）
  components/            TitleBar / TabStrip / Orbs / Toast / Launchpad
  tools/
    types.ts             ToolPlugin 契约
    registry.ts          注册表
    hue.ts               图标调色板
    ui.tsx               工具页共享 UI 原语（ToolPage/ToolHeader/Panel/Seg/ActionPill）
    impl/                内置工具实现（每个一个文件，文件内 registerTool，glob 自动发现）
    impl/index.ts        按设计顺序导入触发注册
```

## 运行

```bash
npm install            # 安装依赖
npm run dev            # ① 纯浏览器开发（默认入口，开箱即用） http://localhost:5173
npm run build          # 类型检查 + 生产打包到 dist/
npm run preview        # 预览生产构建
npm run typecheck      # 仅类型检查
npm run electron:dev   # ② 桌面壳开发（自动起 vite + electron）
npm run electron:build # 打包桌面应用（electron-builder）
```

> **Electron 二进制**：首次安装若网络受限可能跳过了 Electron 运行时二进制下载（仅影响 `electron:*`，不影响 web 构建）。需要桌面壳时执行 `node node_modules/electron/install.js` 重新下载，或设置镜像 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后重装。
> web 构建（`dev` / `build` / `preview`）不依赖该二进制，始终可用。

## 内置工具

即时翻译（接 MyMemory，实时互译）· JSON 格式化（校验 / 美化 / 压缩 / 语法高亮）· Unix 时间戳（双向转换）· 截图贴图（桌面端截图 / 标注 / 置顶贴图）。全部为真实可用的实时计算，非静态图。图标在 `src/assets/icons/` 下（macOS 风格 app 图标）。

### 截图贴图（桌面端）

`screenshot-pin` 是桌面端内置工具：顶部状态操作栏左侧显示功能与权限摘要，中间直接提供两条快捷键设置，右侧保留启用开关、`截图` 和 `截图并贴图`；主体工作区为左侧最近截图、中间标注编辑器、右侧当前贴图。

- 普通 `截图` 完成后会自动把截图图片写入系统剪贴板，同时在右下角显示最近一次截图浮窗；点击浮窗或用键盘确认才进入标注编辑器，未操作 5 秒后自动消失。`截图并贴图` 仍直接创建置顶贴图。
- 最近截图最多保留 5 张，支持打开、贴图、复制、删除；重启后清空。
- 标注编辑器默认以 `适配` 模式显示图片，支持文本、箭头、矩形、圆形、画笔、涂抹式马赛克、点选/框选、移动、Del 删除、拖拽平移和缩放。
- 矩形和圆形可启用 `携带文本`，绘制形状后自动追加并聚焦文本输入；提交后的形状与文本按同一撤销分组处理。
- 快捷键设置已外置到顶部状态操作栏中间，保留启用/关闭、录制、重置、注册状态和冲突反馈；截图贴图页不再提供单独的 `设置` 按钮。
- 宽窗口显示三栏；中等宽度优先保留编辑器并把最近截图/当前贴图放到下一行；窄窗口降为单列。
- 截图能力只通过一方 Electron/preload 桥接给内置工具使用，不暴露给外部插件 SDK。

> 工具集刻意保持精简，但架构为横向扩展而设计——按下文「如何新增一个工具」可零成本加回任意工具。

## 快捷键与全局唤醒

| 操作 | macOS | Windows / Linux |
| --- | --- | --- |
| 聚焦搜索 / 回到启动台 | ⌘K | Ctrl K |
| 关闭当前标签 | ⌘W | Ctrl W |
| 返回启动台 | Esc | Esc |
| 全局唤醒（任意处呼出，仅桌面） | Alt + Space | Alt + Space |

- **全局唤醒**：桌面端注册 `Alt+Space`（`electron/main.cjs` 的 `globalShortcut`），任意处按下即把窗口带到前台、回到启动台并聚焦搜索框。
- **输入即搜索**：窗口激活或在启动台直接敲键，自动定位到搜索框，无需先点击。
- **中文拼音搜索**：搜索框支持拼音全拼 / 首字母匹配（`pinyin-pro`），如输入 `fanyi` 命中「即时翻译」。
- 快捷键标签按平台自动显示（`src/platform/shortcuts.ts`），Windows 显示 Ctrl 而非 ⌘。
- 标题栏 ⚙ 打开**设置面板**（主题切换 / 快捷键一览 / 关于）。
- **第三方应用**：「应用」标签管理你添加的本地应用——点右上角「＋ 添加应用」选择应用文件，点击即可启动（最近打开的排在最前），悬停行末可移除。不预置任何推荐应用，列表持久化在 `localStorage`。

## 扩展工具的两种方式

| 方式 | 适用 | 接入 | 指南 |
| --- | --- | --- | --- |
| **内置工具**（编译期） | 随宿主一起开发/打包的工具，多 agent 并行开发后统一接入 | 往 `src/tools/impl/` 放一个文件（glob 自动发现） | `TOOLS.md` |
| **外部插件**（运行期） | 独立项目独立构建、独立分发的大型工具，可插拔 | 「扩展」面板从 GitHub Release / 本地安装，动态懒加载 | `PLUGINS.md` |

外部插件系统：受信任动态加载 + 桌面优先；插件构建成 IIFE bundle（react/SDK 外置→复用宿主单例）+ `manifest.json`，宿主按需懒加载、可启停/更新/卸载。SDK 以 npm 包 `@maoyugames/ttool-sdk` 分发（源码 `packages/sdk/`，发布前 `prepublishOnly` 编译出 dist），示例插件见 `examples/hello-tool/`。

## 如何新增一个工具（内置）

1. 新建 `src/tools/impl/myTool.tsx`：

   ```tsx
   import { registerTool } from '../registry'
   import { ToolPage, ToolHeader } from '../ui'

   function MyTool() {
     return (
       <ToolPage scroll>
         <ToolHeader glyph="★" hue="blue" title="我的工具" subtitle="一句话描述" />
         {/* …你的 UI… */}
       </ToolPage>
     )
   }

   registerTool({
     id: 'myTool',
     name: '我的工具',
     desc: '列表副标题',
     glyph: '★',
     cat: '开发',        // 开发/文本/时间/翻译/设计 等；空分类自动从筛选栏隐藏，新分类自动出现
     hue: 'blue',
     component: MyTool,
   })
   ```

2. 在 `src/tools/impl/index.ts` 按期望展示位置加一行 `import './myTool'`。

完成——它会自动出现在启动台列表、搜索、分类筛选，并可在标签页打开。**无需改动外壳任何代码。**

- 需要剪贴板 / 打开应用 / 文件选择？用 `useToolbox().copy(text, label)` 或 `platform.xxx`，绝不要直接 import electron。
- 工具输入想跨标签切换保活？用 `usePersistentState('myTool.x', 初始值)` 代替 `useState`。

## 如何接入新平台（例：Tauri）

1. 新建 `src/platform/tauri.ts`，实现 `Platform` 接口（用 `@tauri-apps/api` 实现 `copyText / openExternalApp / pickAppPath / window`）。
2. 在 `src/platform/index.ts` 的 `detect()` 中加入 `if (window.__TAURI__) return createTauriPlatform()`。

核心应用与全部工具**无需任何改动**。

## 翻译服务

即时翻译默认接入 **MyMemory**（免费、无需密钥），封装在 `src/platform/translateApi.ts`：

- **electron**：走主进程 `fetch`（`electron/main.cjs` 的 `translate` IPC），规避 CORS。
- **web**：浏览器直连 MyMemory（其支持 CORS）；若页面注入了 `window.claude.complete` 则优先用它。

换用其它服务（DeepL / Google / 自建）：只需改 `translateApi.ts`（web 侧）与 `main.cjs` 的 `translateText`（桌面侧），UI 与适配器接口不变。

## 说明

- 切换标签时工具组件重挂载以重放入场动效，输入由 `usePersistentState` 保活。
- 全局热键、窗口聚焦事件、第三方应用启动、原生文件选择仅在桌面（Electron）生效；web 下相关能力优雅降级（搜索/翻译/工具计算等核心功能在浏览器完整可用）。
