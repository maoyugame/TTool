# TTool

一个**跨平台桌面多功能工具集**：macOS 毛玻璃质感、「指挥官」风格启动台 + 标签工作区。工具在标签页里真实运行（即时翻译 / JSON 格式化 / Unix 时间戳 / 图片处理），并支持中文拼音搜索、第三方应用快速启动、分类筛选、最近使用、深 / 浅色切换、全局热键唤醒、平台感知键盘快捷键、设置面板。

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

- **核心**：Vite + React 19 + TypeScript（框架无关的 UI 与工具逻辑）
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
npm run check          # 类型、更新器、发布配置、SSR 与生产构建全检查
npm run preview        # 预览生产构建
npm run typecheck      # 仅类型检查
npm run electron:dev   # ② 桌面壳开发（自动起 vite + electron）
npm run electron:build # 打包桌面应用（electron-builder）
npm run electron:build:win # 构建 Windows NSIS 自动更新安装包
```

> **Electron 二进制**：首次安装若网络受限可能跳过了 Electron 运行时二进制下载（仅影响 `electron:*`，不影响 web 构建）。需要桌面壳时执行 `node node_modules/electron/install.js` 重新下载，或设置镜像 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后重装。
> web 构建（`dev` / `build` / `preview`）不依赖该二进制，始终可用。

## Windows 自动更新与发布

- Windows 安装版会在设置页检查 GitHub Releases，发现新版本后由用户确认下载并重启安装；开发态不联网检查。
- 推送与 `package.json` 版本一致的 `v*.*.*` tag 后，GitHub Actions 会执行全检查、构建 NSIS、校验 `latest.yml`/SHA-512/blockmap，再发布非草稿 Release。
- 当前发布仓库按内部私有仓库配置，客户端需由管理员提供只读 token，推荐放在 `TTOOL_UPDATE_GH_TOKEN` 用户环境变量中；凭证不会写入源码或安装包。
- 第一个包含更新器的 `0.2.0` 仍需手工安装；之后才可验证 `0.2.0 → 0.2.1` 自动更新。

完整发布、签名、回滚和真机验收流程见 [`docs/WINDOWS_UPDATE.md`](docs/WINDOWS_UPDATE.md)，Electron/Tauri 与依赖升级评估见 [`docs/RUNTIME_ASSESSMENT.md`](docs/RUNTIME_ASSESSMENT.md)。

## 内置工具

即时翻译（接 MyMemory，实时互译）· JSON 格式化（校验 / 美化 / 压缩 / 语法高亮）· Unix 时间戳（双向转换）· 图片处理（改尺寸 / 旋转翻转 / PNG、JPEG、WebP 转换与压缩）· 截图贴图（桌面端截图 / 标注 / 置顶贴图）· Codex 用量状态（桌面端本机限额与 token 趋势）。全部为真实可用的实时计算，非静态图。图标在 `src/assets/icons/` 下（macOS 风格 app 图标）。

### 图片处理

`image-tool` 是完全在本机渲染进程内运行的内置批量图片工具。可通过文件选择或拖放一次导入多张常见栅格图片，在队列中查看、选择和移除项目；统一修改尺寸、执行 90° 旋转与水平/垂直翻转，并批量导出 PNG、JPEG 或 WebP。

- 单次最多导入 20 个文件、合计 200 MiB；每个输入不超过 50 MiB、单边不超过 16384 px，单张输出不超过 4000 万像素。损坏或不支持的项目会单独报错，不阻塞其他图片。
- 尺寸支持保持原图、百分比、最长边和精确宽高四种模式；JPEG/WebP 可调质量并显示实际压缩前后体积与节省比例，PNG 采用无损重新编码，结果不一定比原文件更小。
- 批处理按顺序执行并显示汇总进度；成功结果可逐张下载，也可一次下载为自动处理重名的 ZIP 文件。
- 原文件不会被覆盖或上传。动态 GIF 等动画输入按静态首帧处理，当前版本不保留 EXIF/ICC 等元数据，也不提供裁剪、修图、标注或图层编辑。
- 临时图片、下载与压缩包资源会在替换结果和离开工具页时释放；功能同时适用于 Web 与 Electron 渲染层，不依赖新的原生桥接或生产依赖。

### 截图贴图（桌面端）

`screenshot-pin` 是桌面端内置工具：顶部状态操作栏左侧显示权限、应用版本、Git 修订和 Capture Core 版本，中间直接提供两条快捷键设置，右侧保留启用开关、`截图`、`截图并贴图`与诊断复制；主体工作区为左侧持久截图历史、中间标注编辑器、右侧当前贴图。

- 普通 `截图` 完成后会自动把截图图片写入系统剪贴板，同时在右下角显示最近一次截图浮窗；点击浮窗或用键盘确认才进入标注编辑器，未操作 5 秒后自动消失。`截图并贴图` 仍直接创建置顶贴图。
- 开始框选前会严格按显示器 `display_id` 抓取不可变 CaptureFrame；浮层显示和最终裁剪使用同一份 PNG。坐标链显式覆盖显示器 DIP、浮层 CSS、实际图片渲染矩形和帧像素，支持混合缩放、负坐标与竖屏，不再回退到错误屏幕。
- 框选层提供放大镜、像素坐标、HEX/RGB/HSV 取色、十字辅助线、Shift 约束、方向键微调和当前屏全选。
- 截图历史默认最多保留 100 条或 128 MB，重启后仍在；支持收藏、回收区、恢复和一键保存到系统图片目录下的 `TTool Screenshots`。
- 标注编辑器默认以 `适配` 模式显示图片，支持文本、编号、箭头、直线、矩形、圆形、画笔、荧光笔、橡皮擦、涂抹式马赛克、点选/框选、键盘微调、移动、Del 删除、拖拽平移和缩放；工具样式会记住上次选择。
- 贴图支持滚轮缩放、Ctrl+滚轮透明度、旋转、水平/垂直翻转、锁定、鼠标穿透、隐藏和缩略；贴图图片、位置与状态会在重启后恢复，关闭贴图才会移除持久记录。
- 矩形和圆形可启用 `携带文本`，绘制形状后自动追加并聚焦文本输入；提交后的形状与文本按同一撤销分组处理。
- 快捷键设置已外置到顶部状态操作栏中间，保留启用/关闭、录制、重置、注册状态和冲突反馈；截图贴图页不再提供单独的 `设置` 按钮。
- 宽窗口显示三栏；中等宽度优先保留编辑器并把最近截图/当前贴图放到下一行；窄窗口降为单列。
- 截图能力只通过一方 Electron/preload 桥接给内置工具使用，不暴露给外部插件 SDK。

### Codex 用量状态（桌面端）

`codex-usage` 是 first-party 内置工具。首次打开工具页、手动显示状态窗或启用常驻时，才会按需启动本机已登录的 `codex app-server`，读取限额与用量快照；未启用常驻时离开工具页会释放该后台进程。

- 不读取、保存或展示 Codex 登录凭据、对话内容或提示内容；工具仅显示本机 App Server 返回的用量快照。
- 可点击“刷新”请求新快照；界面会显示上次成功刷新时间，并在数据过期或刷新失败时保留并标注现有快照。
- 常驻状态窗默认显示在主屏右下角、保持置顶；可拖动顶部“拖动此处”移动，并在工具页调节不透明度。
- token 趋势可切换近 7 / 30 天，数值使用紧凑的 `K` / `M tokens` 表示；悬停、聚焦或点击柱条可查看完整数值。

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

## 如何评估新平台（例：Tauri）

`src/platform/` 允许复用 React 核心 UI，但当前桌面宿主还包含插件安装/加载、TCP/TLS、数据库驱动、safeStorage、截图、多窗口和全局热键。迁移到 Tauri 不只是新增一个适配器，而是需要用 Rust/Tauri 插件重写这些宿主能力并重新验证插件兼容与安全边界。当前决策是继续 Electron；迁移触发条件与成本见 [`docs/RUNTIME_ASSESSMENT.md`](docs/RUNTIME_ASSESSMENT.md)。

## 翻译服务

即时翻译默认接入 **MyMemory**（免费、无需密钥），封装在 `src/platform/translateApi.ts`：

- **electron**：走主进程 `fetch`（`electron/main.cjs` 的 `translate` IPC），规避 CORS。
- **web**：浏览器直连 MyMemory（其支持 CORS）；若页面注入了 `window.claude.complete` 则优先用它。

换用其它服务（DeepL / Google / 自建）：只需改 `translateApi.ts`（web 侧）与 `main.cjs` 的 `translateText`（桌面侧），UI 与适配器接口不变。

## 说明

- 切换标签时工具组件重挂载以重放入场动效，输入由 `usePersistentState` 保活。
- 全局热键、窗口聚焦事件、第三方应用启动、原生文件选择仅在桌面（Electron）生效；web 下相关能力优雅降级（搜索/翻译/工具计算等核心功能在浏览器完整可用）。
