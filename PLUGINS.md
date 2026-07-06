# 外部插件开发与分发指南（运行期 · 可插拔）

本平台支持**运行期插件系统**：每个工具是**独立项目、独立构建**，宿主在运行时从 GitHub/本地**安装、按需懒加载、可启停/卸载/更新**，插件不打进宿主包。适合体量较大的工具与多团队独立维护。

> 与 `TOOLS.md`（内置工具，编译期打进宿主）不同：本文件讲的是**外部插件**，独立分发、动态加载。
> 设计取向：**受信任动态加载 + 桌面优先**。安装的是你信任的仓库代码（类似 VS Code / Obsidian 插件）。

## 工作原理

- **共享单例**：宿主在运行时把 `React` / `ReactDOM` / `react/jsx-runtime` / `@maoyugames/ttool-sdk` 暴露为全局。插件构建时把它们标为 external，因此插件 bundle 不打包 React/SDK，**运行时复用宿主的同一份实例**（只有一份 React，hooks/context 才正常）。
- **产物**：每个插件构建出**一个 IIFE bundle**（如 `tool.js`）+ 一份 `manifest.json`。
- **懒加载**：宿主启动只读 `manifest.json`（拿到名称/图标/分类用于列表）；插件 bundle 在**首次打开时**才注入加载并执行 `registerTool` 回填组件。

## 开发一个插件

最快路径：复制本仓库的 `examples/hello-tool/` 作为模板。

1. **依赖**：`npm i -D @maoyugames/ttool-sdk react vite @vitejs/plugin-react`。`@maoyugames/ttool-sdk` 发布在 npm 公共 registry，提供类型 + 运行期桥接；构建时被 external，不进产物。
2. **写工具**（`src/index.tsx`）：

   ```tsx
   import { defineTool, ToolPage, ToolHeader, usePersistentState, useToolbox } from '@maoyugames/ttool-sdk'

   function MyTool() {
     const { copy } = useToolbox()
     const [text, setText] = usePersistentState('myplugin.text', '')
     return (
       <ToolPage scroll>
         <ToolHeader glyph="★" hue="indigo" title="我的插件" subtitle="一句话描述" />
         {/* …UI，配色用 var(--text)/var(--surface2)/var(--accent) 自动适配深浅色… */}
       </ToolPage>
     )
   }

   defineTool({ id: 'myplugin', name: '我的插件', desc: '一句话描述', glyph: '★', cat: '插件', hue: 'indigo', order: 100, component: MyTool })
   ```

   可用的 SDK 见下方「SDK API」。**只依赖 `@maoyugames/ttool-sdk`，不要自己打包 React。**

3. **构建配置**（`vite.config.ts`，库模式 IIFE + external→全局，见模板）：

   ```ts
   build: {
     lib: { entry: 'src/index.tsx', formats: ['iife'], name: 'MyTool', fileName: () => 'tool.js' },
     rollupOptions: {
       external: ['react', 'react-dom', 'react/jsx-runtime', '@maoyugames/ttool-sdk'],
       output: { globals: { react: 'React', 'react-dom': 'ReactDOM', 'react/jsx-runtime': 'ReactJsxRuntime', '@maoyugames/ttool-sdk': 'TToolSDK' } },
     },
   }
   ```

4. **构建**：`vite build` → 产出 `dist/tool.js`。

## manifest.json 规范

放在插件根（与产物一起发布）：

```json
{
  "id": "myplugin",        // 全局唯一，也是路由 key / 持久化前缀
  "name": "我的插件",
  "desc": "一句话描述",
  "glyph": "★",            // 无 icon 时显示的字形
  "icon": "icon.png",       // 可选：相对 bundle 的图标文件，或 data URL
  "cat": "插件",            // 任意分类（空分类自动隐藏，新分类自动出现在筛选）
  "hue": "indigo",          // blue/purple/amber/teal/green/indigo/pink/gray
  "order": 100,             // 可选，越小越靠前
  "keywords": "myplugin py", // 可选，搜索补充词/拼音
  "version": "1.0.0",
  "entry": "tool.js",       // 入口 bundle 文件名
  "sdk": "1"                // 兼容的 SDK 主版本
}
```

## 发布（正式：GitHub Release）

把构建产物作为 **Release 资产**上传到插件仓库的某个 Release：
- 必须包含：`manifest.json`、入口 bundle（如 `tool.js`）
- 可选：图标文件（与 manifest.icon 同名）

宿主安装时拉取该 repo 的**最新 Release**，下载全部资产到本地。

## 安装（在宿主「扩展」面板，桌面端）

点标题栏 🧩 打开「扩展 · 工具插件」：
- **从 GitHub 安装**：输入 `owner/repo`，拉取最新 Release 安装。
- **开发者模式（在「设置」开启后出现两个本地入口，均选插件的 `dist` 文件夹）**：
  - **🔗 开发者链接（实时调试）**：不复制、直接从外部 `dist/` 加载。改代码 → `npm run dev`（watch）自动重建 → 在 TTool 按 `Ctrl+R` 重载即生效，无需重装。
  - **＋ 从本地文件夹安装（复制）**：把 `dist/` 复制进 `userData`，模拟正式安装态；改代码需重装。
- 已安装列表支持**启用 / 禁用 / 更新（GitHub 来源）/ 卸载**（链接插件卸载只解除链接，不删你的开发目录）。

**调试**：`F12` / `Ctrl+Shift+I` 开发者工具看 Console 报错；`Ctrl+R` / `F5` 重载窗口。
**`dist/` 必须自包含**（`manifest.json` 与 `tool.js` 同层）——脚手架的 `copyManifest` 构建插件会自动放好；若选了项目根目录安装会报错并提示改选 `dist/`。

复制安装落盘在 `<userData>/plugins/<id>/`；链接插件只在 `<userData>/plugins/registry.json` 记一条指向你开发目录的引用。

## SDK API（`@maoyugames/ttool-sdk`）

- `defineTool(spec)` / `registerTool(spec)` —— 注册工具（spec 见上方字段 + `component`）
- UI 原语：`ToolPage` / `ToolHeader` / `Panel` / `Seg` / `ActionPill` / `ToolIcon` / `MONO` / `labelStyle`
- hooks：`usePersistentState(key, init)`（跨标签切换保活）/ `useToolbox()`（`copy`/`flash`/`openTool`）/ `useNow()`
- **数据 / 网络 hooks（仅桌面，自动按插件 id 命名空间）**：
  - `useStorage()` —— 持久化 KV（普通数据：笔记 / 配置）：`get(k,def?)` / `set(k,v)` / `remove(k)` / `keys()`
  - `useSecrets()` —— OS 安全存储**加密**凭证（秘钥 / 密码 / 账号）：`get/set/remove/keys/available`。敏感数据必须用它，勿明文存储。
  - `useNet()` —— 通用 TCP/TLS 字节管道（自实现任意协议）：`connect/write/close/onData/onClose/onError/onDrain`，卸载自动关闭
- **数据库便利层 hooks（自 SDK 1.3.0；卸载自动关闭连接）**：`useMySQL()` / `useRedis()`（RESP2）/ `useMongo()`（EJSON）——`connect(config)` 拿 `connId`，再 `query/command/find/...`。**桌面端已实现并经真实数据库验收**；web 下 `available=false`、调用返回 `NO_DB`，务必先判 `available`。语义见 `HOST-DB-SPEC.md`。
- `platform`（宿主平台能力的裁剪子集）：`kind` / `isDesktop` / `copyText` / `openExternalApp` / `translate?` / `net?` / `storage?` / `secrets?` / `db?`

> 截图/贴图能力是 TTool 内置工具使用的 first-party Electron bridge，不在 `@maoyugames/ttool-sdk` 的插件可见 `platform` 中暴露。外部插件不要访问 `window.ttool.screenshot` 或依赖宿主内部 bridge。

## 约束与注意

- **受信任模型**：插件以宿主同等权限运行，只安装你信任的仓库。
- **不要打包 React / @maoyugames/ttool-sdk**：必须按上面的 external 配置，否则会出现多份 React 导致 hooks 崩溃。
- **id 全局唯一**：与内置工具或其它插件冲突会被忽略。
- **桌面端功能**：插件安装/加载为 Electron 桌面端能力；web 构建只运行内置工具。
- **两个高频坑（详见 `TTOOL-PLUGIN-GUIDE.md` §7）**：
  - **主题**：原生 `<select>`/`<input>` 控件本体配色不跟随深浅主题，需用 CSS 变量显式上色（或用 SDK `Seg`/自绘下拉）；颜色一律用 CSS 变量、勿硬编码（宿主已设 `color-scheme`，下拉弹层/日期选择器等会自动跟随）。
  - **状态保活**：切换工具标签会重挂载你的工具，`useState` 持有的输入/数据会丢失——用 `usePersistentState('<id>.key', init)` 保活（跨重启用 `useStorage`）。
- 平台自带一个示例插件源码 `examples/hello-tool/`，可直接构建体验整条链路。
