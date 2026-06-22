# TTool 插件开发指南（AI 专用 · 自包含脚手架）

> **给 AI 的说明**：本文件是 **TTool 平台**的插件开发规范与脚手架。把本文件放进一个新插件项目目录后，请**严格按本文件**创建并实现一个合规的 TTool 插件项目。本文件自包含——无需访问 TTool 主仓库即可完成创建。
>
> 适用 SDK 版本：**v1**（`manifest.sdk = "1"`）。创建项目时必须遵循「§8 规范（硬性）」与「§9 向下兼容」。

---

## 1. TTool 插件是什么 / 运行原理

TTool 是一个跨平台桌面工具平台（Electron + React）。**插件 = 一个独立项目**，构建出**单个 IIFE bundle**（如 `tool.js`）+ 一份 `manifest.json`，由宿主在运行时**动态安装、懒加载**。

关键机制（决定了下面的构建配置，必须照做）：
- **复用宿主单例**：插件**不打包** React / SDK。`react` / `react-dom` / `react/jsx-runtime` / `@maoyugames/ttool-sdk` 在构建时标为 **external**，映射到宿主注入的全局 `React` / `ReactDOM` / `ReactJsxRuntime` / `TToolSDK`。这样整个应用只有**一份 React**（否则 hooks/context 崩溃）。
- **自注册**：插件入口执行时调用 `defineTool({...})` 向宿主注册一个工具。
- **懒加载**：宿主先读 `manifest.json` 上列表，bundle 在工具首次打开时才加载执行。
- **桌面安装**：宿主从 GitHub Release / 本地文件夹安装到 `userData/plugins/<id>/`。

---

## 2. 要创建的项目结构

```
<plugin-project>/
  package.json
  vite.config.ts
  tsconfig.json
  manifest.json
  .gitignore
  src/index.tsx            ← 插件实现 + defineTool
  (icon.png 可选)
```

> **SDK 来源**：`@maoyugames/ttool-sdk` 已发布到 **npm 公共 registry**，作为 devDependency 安装：`npm i -D @maoyugames/ttool-sdk`。它提供类型；构建时被 external（不打进产物），运行期由宿主提供实现。
> （若 `@maoyugames/ttool-sdk` 尚未发布或离线开发，见 **附录 §11** 的本地 d.ts shim 兜底方案。）

---

## 3. 脚手架文件（逐个复制，按需改名/改 id）

### package.json
把 `your-tool` / `ttool-plugin-xxx` 改成你的工具名。
```json
{
  "name": "ttool-plugin-xxx",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch"
  },
  "devDependencies": {
    "@maoyugames/ttool-sdk": "^1.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.4.5",
    "vite": "^5.2.11"
  }
}
```

### vite.config.ts （**必须保持 external/globals 映射，勿改键名**；含 copyManifest 使 dist 自包含）
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 每次构建后把 manifest.json（及 icon）复制进 dist/，使 dist/ 成为「自包含插件包」
// （manifest.json 与 tool.js 同层，manifest.entry='tool.js' 可解析）。
// 本地安装/链接选 dist/、GitHub Release 上传 dist/* —— 布局一致。build 与 dev(--watch) 都生效。
function copyManifest() {
  return {
    name: 'ttool-copy-manifest',
    closeBundle() {
      const out = resolve('dist')
      copyFileSync('manifest.json', resolve(out, 'manifest.json'))
      try {
        const m = JSON.parse(readFileSync('manifest.json', 'utf8'))
        if (m.icon && !/^data:/.test(m.icon) && existsSync(m.icon)) {
          copyFileSync(m.icon, resolve(out, m.icon.split('/').pop()))
        }
      } catch {
        /* 无 icon 或解析失败时忽略 */
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), copyManifest()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: { entry: 'src/index.tsx', formats: ['iife'], name: 'TToolPlugin', fileName: () => 'tool.js' },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', '@maoyugames/ttool-sdk'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'ReactJsxRuntime',
          '@maoyugames/ttool-sdk': 'TToolSDK',
        },
        entryFileNames: 'tool.js',
        assetFileNames: '[name][extname]',
      },
    },
  },
})
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

> 类型来自已安装的 `@maoyugames/ttool-sdk`。无需本地类型声明文件（除非走附录 §11 的离线兜底）。

### manifest.json （字段规范见 §6；id 必须全局唯一，sdk 必须为 "1"）
```json
{
  "id": "xxx",
  "name": "我的工具",
  "desc": "一句话描述",
  "glyph": "★",
  "cat": "插件",
  "hue": "indigo",
  "order": 100,
  "keywords": "xxx pinyin",
  "version": "1.0.0",
  "entry": "tool.js",
  "sdk": "1"
}
```

### .gitignore
```
node_modules
dist
```

### src/index.tsx （示例实现，按需替换业务）
```tsx
import { defineTool, ToolPage, ToolHeader, usePersistentState, useToolbox } from '@maoyugames/ttool-sdk'

function MyTool() {
  const { copy } = useToolbox()
  const [text, setText] = usePersistentState('xxx.text', '')
  return (
    <ToolPage scroll>
      <ToolHeader glyph="★" hue="indigo" title="我的工具" subtitle="一句话描述" />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ width: '100%', height: 120, borderRadius: 13, background: 'var(--surface2)', border: '1px solid var(--hair)', resize: 'none', padding: 15, fontSize: 15, color: 'var(--text)' }}
      />
      <div onClick={() => copy(text, '结果')} style={{ marginTop: 14, display: 'inline-flex', fontSize: 13, fontWeight: 560, color: '#fff', background: 'var(--accent)', padding: '9px 18px', borderRadius: 10, cursor: 'pointer' }}>
        复制
      </div>
    </ToolPage>
  )
}

// id 必须与 manifest.json 的 id 完全一致
defineTool({ id: 'xxx', name: '我的工具', desc: '一句话描述', glyph: '★', cat: '插件', hue: 'indigo', order: 100, keywords: 'xxx pinyin', component: MyTool })
```

---

## 4. SDK API（`@maoyugames/ttool-sdk`，运行时复用宿主实例）

- **注册**：`defineTool(spec)` / `registerTool(spec)`（spec 见 ToolSpec；`component` 为工具主体组件）。
- **UI 原语**（与平台视觉一致，强烈建议使用）：`ToolPage`（`scroll?` 可滚动/纵向填充两种布局）、`ToolHeader`、`Panel`、`Seg`（分段切换）、`ActionPill`、`ToolIcon`、`MONO`（等宽字体栈）、`labelStyle`。
- **hooks**：`usePersistentState(key, initial)`（跨标签切换保活，**key 必须以插件 id 前缀**）、`useToolbox()` → `copy(text,label?)` / `flash(msg)` / `openTool(id)`、`useNow()`（每秒 Unix 秒）。
- **数据 / 网络 hooks（仅桌面；自动按你的插件 id 命名空间，无需自己传 id。web 端各方法优雅降级为默认值/no-op）**：
  - `useStorage()` → `{ available, get(key, fallback?), set(key, value), remove(key), keys() }`：**持久化 KV**，存普通数据（笔记 / 配置 / 收藏）。落盘宿主 userData，按插件隔离（防键碰撞）。`set` 的 value 必须可 JSON 序列化。**普通数据用它，不要再往 localStorage 塞。**
  - `useSecrets()` → `{ available(), get(key), set(key, value), remove(key), keys() }`：**加密凭证存储**（秘钥 / 密码 / 账号 token）。底层用 OS 安全存储（Windows DPAPI / macOS Keychain）**加密落盘**。**敏感数据一律用它，严禁明文存 localStorage / storage。** 系统不支持加密时 `available()` 返回 false。
  - `useNet()` → `{ available, connect({host,port,tls?,timeoutMs?}), write(socketId, Uint8Array), close(socketId), onData/onClose/onError/onDrain(socketId, cb)→取消订阅 }`：**通用 TCP/TLS 字节管道**，用于自实现任意 TCP 协议（数据库 / 自定义协议客户端等）。组件卸载时本 hook 打开的 socket 自动关闭。`write` 返回 `{ok,backpressure}`，`backpressure` 为真时应等 `onDrain` 再续写。
- **数据库便利层 hooks（自 SDK 1.3.0；自动按插件 id 计连接数，卸载自动关闭本 hook 打开的连接）**：
  - `useMySQL()` → `{ available, connect(config), query(connId, sql, params?), close(connId), ping(connId) }`
  - `useRedis()` → `{ available, connect(config), command(connId, args[], {binary?}), pipeline(connId, cmds[]), close(connId), ping(connId) }`（RESP2；二进制值用 `binary:true` 取 `Uint8Array`）
  - `useMongo()` → `{ available, connect(config), find/countDocuments/aggregate/distinct/insertOne/insertMany/updateOne/updateMany/replaceOne/deleteOne/deleteMany/listDatabases/listCollections/listIndexes/createIndex/dropIndex/runCommand(connId, …), close(connId), ping(connId) }`（值用 Extended JSON，如 `{$oid}`/`{$date}`）
  - **桌面端已实现并经真实数据库验收**（MySQL/Redis/MongoDB，自 SDK 1.3.0）；**web 下** `available` 为 `false`、调用返回 `{ok:false,code:'NO_DB'}`，**务必先判 `available` 再使用**。统一错误码、类型保真（大整数/DECIMAL/JSON→字符串、BLOB→Uint8Array、Mongo EJSON canonical 保精度）、结果体量封顶等语义见仓库 `HOST-DB-SPEC.md`。
- **platform**（宿主能力裁剪子集）：`kind` / `isDesktop` / `copyText` / `openExternalApp` / `translate?` / `net?` / `storage?` / `secrets?` / `db?`（后几者为上述 hooks 的底层 API，一般直接用 hooks 即可）。

配色与排版**一律用 CSS 变量**（自动适配深/浅色）：`var(--text)` / `var(--text2)` / `var(--text3)` / `var(--surface)` / `var(--surface2)` / `var(--hair)` / `var(--hair2)` / `var(--field)` / `var(--fieldHair)` / `var(--accent)` / `var(--accentSoft)` / `var(--good)` / `var(--pill)`。

---

## 5. 开发 / 构建 / 自测 / 发布

1. `npm install`（装 react + vite + plugin-react + `@maoyugames/ttool-sdk`）。
2. 实现 `src/index.tsx`，确保 `defineTool` 的 `id` 与 `manifest.json` 的 `id` 一致。
3. `npm run build` → 产出 **自包含的 `dist/`**：`vite.config.ts` 里的 `copyManifest` 插件（§3 脚手架已含）会在每次构建后把 `manifest.json`（及 `icon`）复制进 `dist/`，因此 `dist/` 内含 `manifest.json` + `tool.js`（+ 图标）**同层**——`manifest.entry:"tool.js"` 正确解析。**`dist/` 就是你的插件包**，本地安装与 GitHub 发布都用它。

### 5.1 本地调试 / debug 测试（开发者模式）

> 在 TTool 桌面端「设置」开启「**开发者模式**」→ 标题栏 🧩 打开「扩展」面板，dev 模式下会出现两个本地入口。**选插件的「项目根目录」或 `dist` 文件夹都可以**——宿主会自动定位 `manifest.json`（项目根或 dist 内）与入口 bundle（根 / `dist/`），两种选法均可。

- **🔗 开发者链接（实时调试，推荐）**：选目录后**不复制**、直接从该目录加载。调试循环最顺：
  1. 终端跑 `npm run dev`（= `vite build --watch`，改 `src` 自动重新构建 `dist/`）；
  2. 在 TTool 里改完代码、等 watch 重新构建好，按 **`Ctrl+R`（macOS `⌘R`）重载窗口**，新代码即生效——**无需重新安装**；
  3. 按 **`F12`（或 `Ctrl+Shift+I`）打开开发者工具**，在 Console 看插件的 `console.log` 与报错堆栈。
- **＋ 从本地文件夹安装（复制）**：选目录后把内容**复制**进宿主 `userData/plugins/<id>/`（落地为自包含目录）。改代码后需**重新安装**才更新（适合模拟正式安装后的状态，不便于反复调试）。

**调试快捷键（任意构建均可用）**：`F12` / `Ctrl+Shift+I` 开关开发者工具；`Ctrl+R` / `F5` 重载窗口。

### 5.2 常见错误与排查

| 现象 / 报错 | 原因 | 解决 |
| --- | --- | --- |
| 安装报“找不到 manifest.json” | 选的目录及其父目录都没有 `manifest.json` | 选插件「项目根目录」或其 `dist` 文件夹；确认 `npm run build` 已产出 |
| `plugins:readBundle ... ENOENT ... tool.js` | 入口 bundle 没构建出来 | 先 `npm run build`（产物 `dist/tool.js`），再安装/链接 |
| 插件不显示 / Console: `SDK v? 主版本不兼容` | `manifest.sdk` 主版本与宿主不符 | 置为 `"1"`（见 §9） |
| Console: `Invalid hook call` / 多份 React | 把 React/SDK 打进了 bundle | 严格按 §3 的 `external` + `globals` 配置，别 `npm i` 后又被打包 |
| 插件里 `useMySQL()` 等 `available` 为 false / 返回 `NO_DB` | 在 web 端，或宿主未接入对应能力 | DB/net/storage 仅桌面端可用；先判 `available` 再用 |
| 改了代码但 TTool 没变化 | 链接模式忘了重载，或复制模式忘了重装 | 链接模式按 `Ctrl+R` 重载；复制模式重新安装 |
| **`<select>` 下拉/控件配色不跟随深浅主题** | 见 §7.1 | 用 CSS 变量给控件上色 + 优先用 `Seg`/自绘下拉 |
| **切换工具标签后，之前输入/查询结果消失** | 切标签会重挂载工具（见 §7.2） | 用 `usePersistentState`（key 带插件 id 前缀）保活 |

### 5.3 正式发布（GitHub Release）

在插件仓库发一个 Release，**把 `dist/` 里的文件作为附件全部上传**：`manifest.json`、`tool.js`（及可选图标，文件名与 `manifest.icon` 一致）。用户在 TTool「扩展」面板输入 `owner/repo` 即可拉取最新 Release 安装。

---

## 6. manifest.json 字段规范

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 全局唯一（也是路由 key / 持久化前缀）；小写字母数字与 `._-`，**不能是 `.`/`..`**；不得与平台内置工具（`translate`/`json`/`timestamp`）或其它插件重名 |
| `name` | ✅ | 显示名 |
| `desc` | ✅ | 列表副标题 |
| `glyph` | ✅ | 无图标图片时显示的字形（1–2 字符 / emoji） |
| `cat` | ✅ | 分类（任意字符串；空分类自动隐藏、新分类自动出现于筛选）。无明确归类用 `"插件"` |
| `hue` | ✅ | 图标配色：`blue/purple/amber/teal/green/indigo/pink/gray` |
| `version` | ✅ | 插件语义化版本 |
| `entry` | ✅ | 入口 bundle 文件名，固定用 `"tool.js"` |
| `sdk` | ✅ | 兼容的 **SDK 主版本**，当前必须为 `"1"`（见 §9） |
| `icon` | ⬜ | 图标文件名（与 bundle 同目录）或 data URL；省略则用 glyph |
| `order` | ⬜ | 展示排序，越小越靠前 |
| `keywords` | ⬜ | 搜索补充词 / 拼音别名 |

---

## 7. 常见坑与最佳实践（务必先读，避免反复踩）

### 7.1 主题：原生控件不会自动跟随深浅色

平台用 CSS 变量做深/浅色自适应（`var(--text)` / `var(--field)` …）。**普通元素只要用这些变量就会自动适配**；但 `<select>` / `<option>` / `<input>` 等**原生控件**默认用浏览器/OS 配色，不读你的 CSS 变量——在深色主题下常显示成「白底黑字」，很突兀。

- 宿主已对整个应用设了 `color-scheme`，所以原生控件的**下拉弹层、日期选择器、复选框、控件内滚动条**会**自动跟随**当前深浅主题——这部分你无需处理。
- 但**控件本体的背景/文字/边框仍需你显式用 CSS 变量上色**，否则闭合态颜色不统一：

```tsx
// ❌ 裸 select：闭合态配色不跟随主题
<select>{/* ... */}</select>

// ✅ 显式用 CSS 变量；option 也给底色（部分平台下拉项需要）
<select style={{ background: 'var(--field)', color: 'var(--text)', border: '1px solid var(--fieldHair)', borderRadius: 8, padding: '6px 10px' }}>
  <option style={{ background: 'var(--surface)', color: 'var(--text)' }}>选项</option>
</select>
```

- **更省心**：优先用 SDK 的 `<Seg>`（分段选择）或**自绘下拉**（普通 div + 绝对定位列表），它们用 CSS 变量、配色完全可控、跨平台一致。
- 铁律：**任何颜色都用 CSS 变量，绝不硬编码**（如 `#fff` / `black` / `rgb(...)`）；可用令牌见 §4 末尾列表。

### 7.2 状态保活：切换工具标签会「重挂载」你的工具

平台在**切换工具标签时会卸载并重新挂载**你的工具组件（用于重放入场动效）。这意味着用 `useState`/`useRef` 持有的一切——输入框内容、已查询的数据、列表、滚动位置、展开/折叠状态——**在切走再切回后会全部丢失、组件从初始态重来**。

- **解决：用 `usePersistentState(key, 初始值)` 代替 `useState`**，它把状态存在宿主模块级存储里、跨重挂载存活，写法和 `useState` 一样：

```tsx
import { usePersistentState } from '@maoyugames/ttool-sdk'

// ❌ 切标签后丢失
const [sql, setSql] = useState('')
// ✅ 跨标签切换存活（key 必须带插件 id 前缀，避免与其它工具冲突）
const [sql, setSql] = usePersistentState('mysql.sql', '')
// 不想切回来重新请求的数据/结果，也用它缓存：
const [rows, setRows] = usePersistentState<Row[]>('mysql.rows', [])
```

- **生效范围**：`usePersistentState` 在**本次应用运行期间**一直存活（切标签、重挂载都不丢），但**应用重启后清空**。
  - 要**跨重启持久**的数据（草稿、收藏、配置）→ 用 `useStorage()`（落盘，见 §4）。
  - 要存**密码/密钥/token** → 用 `useSecrets()`（加密落盘，见 §4）。
- `useEffect` 里发起的请求会在**每次重挂载时重跑**——若不希望切回来就重新请求，把结果用 `usePersistentState` 缓存，并在 effect 里先判断「已有缓存则跳过」。

---

## 8. 规范（硬性，违反会导致加载失败或被拒绝）

1. **绝不打包 React / @maoyugames/ttool-sdk**：必须严格按 §3 的 `external` + `globals` 配置；否则出现多份 React，hooks/context 崩溃。
2. **id 全局唯一**：与内置工具或其它插件冲突会被宿主忽略（不显示），且 `manifest.id` 不得为 `.`/`..` 或含路径分隔符。
3. **`manifest.id` 必须等于 `defineTool` 的 `id`**。
4. **`manifest.sdk` 必须声明当前 SDK 主版本 `"1"`**：主版本与宿主不一致会被拒绝加载并告警。
5. **持久化状态 key 必须以插件 id 前缀**（如 `usePersistentState('<id>.foo', ...)`），避免与其它工具冲突。
6. **配色/排版用 CSS 变量**，不要硬编码颜色，确保深/浅色自适应。
7. **只依赖 `@maoyugames/ttool-sdk` 暴露的能力**：不要 `import` electron / node 内置模块、不要访问 `window.ttool`/`window.TToolSDK` 之外的宿主内部；需要系统能力（剪贴板/打开应用/翻译）走 `platform`。
8. **受信任模型**：插件以宿主同等权限运行（桌面端）。请勿编写恶意/越权代码；用户安装的是其信任的仓库。
9. **入口文件名固定 `tool.js`**，`manifest.entry` 与之一致；`entry`/`icon` 不得用 `..` 逃出插件目录（宿主会拒绝）。
10. **不在顶层执行有副作用的初始化**（全局监听/计时器等）：插件可能被多次加载，副作用应放进组件生命周期内并自行清理。
11. **敏感数据必须用 `useSecrets()`**（加密落盘），**严禁**把秘钥 / 密码 / 账号 token 明文写进 `localStorage` 或 `useStorage()`（后者明文落盘）。普通数据用 `useStorage()` 而非自行操作 `localStorage`，以获得按插件命名空间与统一管理。

---

## 9. SDK 版本与向下兼容

- **当前 SDK 主版本：v1**。所有插件 `manifest.sdk = "1"`。
- **宿主按主版本校验**：`manifest.sdk` 主版本 ≠ 宿主 SDK 主版本时，宿主拒绝加载该插件并提示，避免运行期崩溃。
- **同主版本内只增不改**：v1 期间，SDK 只新增 API、不删除/不改变既有 API 与行为；据此版本写的插件在后续 v1.x 宿主上持续可用（向下兼容）。
- **破坏性变更才升主版本**（v2）：届时旧插件（`sdk:"1"`）会被新宿主优雅拒绝，需作者升级适配后改 `sdk:"2"`。
- 因此：**请使用稳定的 SDK API**（本文件 §4 列出的），不要依赖未在此列出的宿主内部实现。

---

## 10. 验收清单（创建后逐项确认）

- [ ] 目录含 §2 全部文件；`manifest.id` == `defineTool` 的 `id`；`manifest.sdk` == `"1"`
- [ ] `vite.config.ts` 的 external/globals 与 §3 完全一致（react/react-dom/react/jsx-runtime/@maoyugames/ttool-sdk），并含 `copyManifest` 插件
- [ ] `npm run build` 成功，**`dist/` 内同时有 `tool.js` 与 `manifest.json`**（+ 可选图标）；bundle **未打包** React（体积应很小）
- [ ] 只用了 §4 列出的 SDK 能力；配色全用 CSS 变量；持久化 key 带 id 前缀
- [ ] 顶层无副作用初始化
- [ ] 本地（开发者模式）**选 `dist/` 文件夹**链接/安装后，能在 TTool 启动台看到并打开、功能正常（按 `F12` 看 Console 无报错）

---

## 11. 附录：离线 / 未发布兜底（本地类型 shim）

正常情况用 `npm i -D @maoyugames/ttool-sdk` 即可。**仅当** `@maoyugames/ttool-sdk` 尚未发布、或需离线开发时，用下面的本地类型声明兜底（构建时 `@maoyugames/ttool-sdk` 仍被 external，无需真实安装）：

1. package.json 的 devDependencies **去掉** `@maoyugames/ttool-sdk`。
2. tsconfig.json 的 `include` 改为 `["src", "types"]`。
3. 新建 `types/ttool-sdk.d.ts`：

```ts
declare module '@maoyugames/ttool-sdk' {
  import type { ComponentType, ReactNode, CSSProperties } from 'react'
  export type HueName = 'blue' | 'purple' | 'amber' | 'teal' | 'green' | 'indigo' | 'pink' | 'gray'
  export interface ToolSpec {
    id: string
    name: string
    desc: string
    glyph: string
    icon?: string
    cat: string
    hue: HueName
    order?: number
    keywords?: string
    component: ComponentType
  }
  export function registerTool(spec: ToolSpec): void
  export function defineTool(spec: ToolSpec): void
  export const ToolPage: ComponentType<{ scroll?: boolean; children?: ReactNode }>
  export const ToolHeader: ComponentType<{ glyph: string; icon?: string; hue: HueName; glyphSize?: number; glyphWeight?: number; title: string; subtitle?: ReactNode; right?: ReactNode; mb?: number }>
  export const Panel: ComponentType<{ label: ReactNode; right?: ReactNode; children?: ReactNode; flex?: boolean }>
  export const Seg: ComponentType<{ options: { key: string; label: string }[]; value: string; onChange: (k: string) => void }>
  export const ActionPill: ComponentType<{ onClick: () => void; primary?: boolean; children?: ReactNode }>
  export const ToolIcon: ComponentType<{ icon?: string; glyph: string; hue: HueName; size: number; radius: number; glyphSize: number; glyphWeight?: number; shadow?: 'list' | 'header' | 'none' }>
  export const MONO: string
  export const labelStyle: CSSProperties
  export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void]
  export function useToolbox(): { copy(text: string, label?: string): void; flash(msg: string): void; openTool(id: string): void }
  export function useNow(): number
  export interface NetConnectOptions { host: string; port: number; tls?: boolean | { servername?: string; rejectUnauthorized?: boolean }; timeoutMs?: number }
  export interface NetConnectResult { ok: boolean; socketId?: string; code?: string; error?: string }
  export interface NetWriteResult { ok: boolean; backpressure?: boolean; code?: string; error?: string }
  export function useStorage(): {
    readonly available: boolean
    get<T = unknown>(key: string, fallback?: T): Promise<T | undefined>
    set(key: string, value: unknown): Promise<boolean>
    remove(key: string): Promise<boolean>
    keys(): Promise<string[]>
  }
  export function useSecrets(): {
    available(): Promise<boolean>
    get(key: string): Promise<string | undefined>
    set(key: string, value: string): Promise<boolean>
    remove(key: string): Promise<boolean>
    keys(): Promise<string[]>
  }
  export function useNet(): {
    readonly available: boolean
    connect(opts: NetConnectOptions): Promise<NetConnectResult>
    write(socketId: string, data: Uint8Array): Promise<NetWriteResult>
    close(socketId: string): Promise<{ ok: boolean }>
    onData(socketId: string, cb: (chunk: Uint8Array) => void): () => void
    onClose(socketId: string, cb: (info: { hadError: boolean }) => void): () => void
    onError(socketId: string, cb: (err: { error: string; code?: string }) => void): () => void
    onDrain(socketId: string, cb: () => void): () => void
  }
  // 数据库便利层（自 1.3.0）；EJSON = extended-JSON plain object（如 {$oid}/{$date}）
  export type DbCode = 'AUTH_FAILED' | 'CONN_REFUSED' | 'TIMEOUT' | 'DNS_FAIL' | 'TLS_FAIL' | 'NO_CONN' | 'STALE_CONN' | 'TOO_MANY_CONNS' | 'BAD_ARGS' | 'DUP_KEY' | 'SYNTAX_ERR' | 'EJSON_INVALID' | 'RESULT_TRUNCATED' | 'NO_DB' | 'UNKNOWN'
  export interface DbConnectResult { ok: boolean; connId?: string; serverVersion?: string; code?: DbCode; error?: string }
  export interface DbSimpleResult { ok: boolean; code?: DbCode; error?: string }
  export type EJSON = unknown
  export type RedisReply = string | number | null | Uint8Array | RedisReply[] | { _t: 'error'; message: string }
  export function useMySQL(): {
    readonly available: boolean
    connect(config: { host: string; port?: number; user?: string; password?: string; database?: string; ssl?: boolean | { rejectUnauthorized?: boolean }; connectTimeoutMs?: number }): Promise<DbConnectResult>
    query(connId: string, sql: string, params?: unknown[]): Promise<{ ok: boolean; durationMs?: number; result?: { kind: 'rows' | 'ok'; rows?: Record<string, unknown>[]; fields?: { name: string; type?: string }[]; affectedRows?: number; insertId?: string; changedRows?: number; truncated?: boolean }; code?: DbCode; error?: string; driverCode?: string; errno?: number }>
    close(connId: string): Promise<DbSimpleResult>
    ping(connId: string): Promise<DbSimpleResult>
  }
  export function useRedis(): {
    readonly available: boolean
    connect(config: { host: string; port?: number; username?: string; password?: string; db?: number; tls?: boolean | { rejectUnauthorized?: boolean }; connectTimeoutMs?: number }): Promise<DbConnectResult>
    command(connId: string, args: (string | number | Uint8Array)[], opts?: { binary?: boolean }): Promise<{ ok: boolean; durationMs?: number; reply?: RedisReply; code?: DbCode; error?: string; driverCode?: string }>
    pipeline(connId: string, cmds: { args: (string | number | Uint8Array)[]; binary?: boolean }[]): Promise<{ ok: boolean; durationMs?: number; replies?: RedisReply[]; code?: DbCode; error?: string }>
    close(connId: string): Promise<DbSimpleResult>
    ping(connId: string): Promise<DbSimpleResult>
  }
  export function useMongo(): {
    readonly available: boolean
    connect(config: { uri?: string; host?: string; port?: number; user?: string; password?: string; authSource?: string; tls?: boolean; replicaSet?: string; connectTimeoutMs?: number }): Promise<DbConnectResult>
    listDatabases(connId: string): Promise<{ ok: boolean; names?: string[]; code?: DbCode; error?: string }>
    listCollections(connId: string, db: string): Promise<{ ok: boolean; names?: string[]; code?: DbCode; error?: string }>
    find(connId: string, db: string, coll: string, opts?: { filter?: EJSON; projection?: EJSON; sort?: EJSON; limit?: number; skip?: number }): Promise<{ ok: boolean; durationMs?: number; docs?: EJSON[]; truncated?: boolean; code?: DbCode; error?: string }>
    countDocuments(connId: string, db: string, coll: string, filter?: EJSON): Promise<{ ok: boolean; count?: number; code?: DbCode; error?: string }>
    aggregate(connId: string, db: string, coll: string, pipeline: EJSON[], opts?: EJSON): Promise<{ ok: boolean; docs?: EJSON[]; truncated?: boolean; code?: DbCode; error?: string }>
    distinct(connId: string, db: string, coll: string, field: string, filter?: EJSON, options?: EJSON): Promise<{ ok: boolean; docs?: EJSON[]; code?: DbCode; error?: string }>
    insertOne(connId: string, db: string, coll: string, doc: EJSON): Promise<{ ok: boolean; insertedId?: EJSON; code?: DbCode; error?: string }>
    insertMany(connId: string, db: string, coll: string, docs: EJSON[]): Promise<{ ok: boolean; insertedIds?: EJSON[]; code?: DbCode; error?: string }>
    updateOne(connId: string, db: string, coll: string, filter: EJSON, update: EJSON, opts?: EJSON): Promise<{ ok: boolean; matchedCount?: number; modifiedCount?: number; upsertedId?: EJSON; code?: DbCode; error?: string }>
    updateMany(connId: string, db: string, coll: string, filter: EJSON, update: EJSON, opts?: EJSON): Promise<{ ok: boolean; matchedCount?: number; modifiedCount?: number; upsertedId?: EJSON; code?: DbCode; error?: string }>
    replaceOne(connId: string, db: string, coll: string, filter: EJSON, replacement: EJSON, opts?: EJSON): Promise<{ ok: boolean; matchedCount?: number; modifiedCount?: number; upsertedId?: EJSON; code?: DbCode; error?: string }>
    deleteOne(connId: string, db: string, coll: string, filter: EJSON): Promise<{ ok: boolean; deletedCount?: number; code?: DbCode; error?: string }>
    deleteMany(connId: string, db: string, coll: string, filter: EJSON): Promise<{ ok: boolean; deletedCount?: number; code?: DbCode; error?: string }>
    listIndexes(connId: string, db: string, coll: string): Promise<{ ok: boolean; docs?: EJSON[]; code?: DbCode; error?: string }>
    createIndex(connId: string, db: string, coll: string, keys: EJSON, opts?: EJSON): Promise<{ ok: boolean; name?: string; code?: DbCode; error?: string }>
    dropIndex(connId: string, db: string, coll: string, name: string): Promise<DbSimpleResult>
    runCommand(connId: string, db: string, command: EJSON): Promise<{ ok: boolean; result?: EJSON; code?: DbCode; error?: string }>
    close(connId: string): Promise<DbSimpleResult>
    ping(connId: string): Promise<DbSimpleResult>
  }
  export const platform: {
    readonly kind: 'web' | 'electron' | 'tauri'
    readonly isDesktop: boolean
    copyText(text: string): Promise<void>
    openExternalApp(path: string): Promise<{ ok: boolean; error?: string }>
    translate?(text: string, from: string, to: string): Promise<string>
  }
}
```

> 该 shim 必须与官方 `@maoyugames/ttool-sdk` 类型保持一致；一旦能用 npm 安装，建议改回 §3 的标准方式。
