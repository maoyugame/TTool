# TTool 插件开发指南（AI 专用 · 自包含脚手架）

> **给 AI 的说明**：本文件是 **TTool 平台**的插件开发规范与脚手架。把本文件放进一个新插件项目目录后，请**严格按本文件**创建并实现一个合规的 TTool 插件项目。本文件自包含——无需访问 TTool 主仓库即可完成创建。
>
> 适用 SDK 版本：**v1**（`manifest.sdk = "1"`）。创建项目时必须遵循「§8 规范（硬性）」与「§9 向下兼容」。

---

## 1. TTool 插件是什么 / 运行原理

TTool 是一个跨平台桌面工具平台（Electron + React）。**插件 = 一个独立项目**，构建出**单个 IIFE bundle**（如 `tool.js`）+ 一份 `manifest.json`，由宿主在运行时**动态安装、懒加载**。

关键机制（决定了下面的构建配置，必须照做）：
- **复用宿主单例**：插件**不打包** React / SDK。`react` / `react-dom` / `react/jsx-runtime` / `@ttool/sdk` 在构建时标为 **external**，映射到宿主注入的全局 `React` / `ReactDOM` / `ReactJsxRuntime` / `TToolSDK`。这样整个应用只有**一份 React**（否则 hooks/context 崩溃）。
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
  types/ttool-sdk.d.ts     ← @ttool/sdk 的本地类型声明（让 TS/编辑器识别，构建时被 external）
  src/index.tsx            ← 插件实现 + defineTool
  (icon.png 可选)
```

> 说明：因 `@ttool/sdk` 在构建时被 external（不打进产物），**无需 npm 安装它**；用 `types/ttool-sdk.d.ts` 提供类型即可。运行期由宿主提供实现。

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
    "@vitejs/plugin-react": "^4.3.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.4.5",
    "vite": "^5.2.11"
  }
}
```

### vite.config.ts （**必须保持 external/globals 映射，勿改键名**）
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: { entry: 'src/index.tsx', formats: ['iife'], name: 'TToolPlugin', fileName: () => 'tool.js' },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', '@ttool/sdk'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'ReactJsxRuntime',
          '@ttool/sdk': 'TToolSDK',
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
  "include": ["src", "types"]
}
```

### types/ttool-sdk.d.ts （让 `import ... from '@ttool/sdk'` 有类型；构建时被 external）
```ts
declare module '@ttool/sdk' {
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
  export const platform: {
    readonly kind: 'web' | 'electron' | 'tauri'
    readonly isDesktop: boolean
    copyText(text: string): Promise<void>
    openExternalApp(path: string): Promise<{ ok: boolean; error?: string }>
    translate?(text: string, from: string, to: string): Promise<string>
  }
}
```

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
import { defineTool, ToolPage, ToolHeader, usePersistentState, useToolbox } from '@ttool/sdk'

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

## 4. SDK API（`@ttool/sdk`，运行时复用宿主实例）

- **注册**：`defineTool(spec)` / `registerTool(spec)`（spec 见 ToolSpec；`component` 为工具主体组件）。
- **UI 原语**（与平台视觉一致，强烈建议使用）：`ToolPage`（`scroll?` 可滚动/纵向填充两种布局）、`ToolHeader`、`Panel`、`Seg`（分段切换）、`ActionPill`、`ToolIcon`、`MONO`（等宽字体栈）、`labelStyle`。
- **hooks**：`usePersistentState(key, initial)`（跨标签切换保活，**key 必须以插件 id 前缀**）、`useToolbox()` → `copy(text,label?)` / `flash(msg)` / `openTool(id)`、`useNow()`（每秒 Unix 秒）。
- **platform**（宿主能力裁剪子集）：`kind` / `isDesktop` / `copyText` / `openExternalApp` / `translate?`。

配色与排版**一律用 CSS 变量**（自动适配深/浅色）：`var(--text)` / `var(--text2)` / `var(--text3)` / `var(--surface)` / `var(--surface2)` / `var(--hair)` / `var(--hair2)` / `var(--field)` / `var(--fieldHair)` / `var(--accent)` / `var(--accentSoft)` / `var(--good)` / `var(--pill)`。

---

## 5. 开发 / 构建 / 自测 / 发布

1. `npm install`（仅装 react + vite + plugin-react，**不装 @ttool/sdk**）。
2. 实现 `src/index.tsx`，确保 `defineTool` 的 `id` 与 `manifest.json` 的 `id` 一致。
3. `npm run build` → 产出 `dist/tool.js`。
4. **本地自测**：在 TTool 桌面端「设置」开启「开发者模式」→「扩展」→「从本地文件夹安装」，选一个含 `manifest.json` + `dist/tool.js`（及图标）的文件夹即可。建议把 `manifest.json` 与 `dist/tool.js` 放一起，或构建脚本拷到 `dist/`。
5. **正式发布（GitHub Release）**：在插件仓库发一个 Release，**附件包含** `manifest.json`、`tool.js`（及可选图标，文件名与 `manifest.icon` 一致）。用户在 TTool「扩展」面板输入 `owner/repo` 即可拉取最新 Release 安装。

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

## 8. 规范（硬性，违反会导致加载失败或被拒绝）

1. **绝不打包 React / @ttool/sdk**：必须严格按 §3 的 `external` + `globals` 配置；否则出现多份 React，hooks/context 崩溃。
2. **id 全局唯一**：与内置工具或其它插件冲突会被宿主忽略（不显示），且 `manifest.id` 不得为 `.`/`..` 或含路径分隔符。
3. **`manifest.id` 必须等于 `defineTool` 的 `id`**。
4. **`manifest.sdk` 必须声明当前 SDK 主版本 `"1"`**：主版本与宿主不一致会被拒绝加载并告警。
5. **持久化状态 key 必须以插件 id 前缀**（如 `usePersistentState('<id>.foo', ...)`），避免与其它工具冲突。
6. **配色/排版用 CSS 变量**，不要硬编码颜色，确保深/浅色自适应。
7. **只依赖 `@ttool/sdk` 暴露的能力**：不要 `import` electron / node 内置模块、不要访问 `window.ttool`/`window.TToolSDK` 之外的宿主内部；需要系统能力（剪贴板/打开应用/翻译）走 `platform`。
8. **受信任模型**：插件以宿主同等权限运行（桌面端）。请勿编写恶意/越权代码；用户安装的是其信任的仓库。
9. **入口文件名固定 `tool.js`**，`manifest.entry` 与之一致；`entry`/`icon` 不得用 `..` 逃出插件目录（宿主会拒绝）。
10. **不在顶层执行有副作用的初始化**（全局监听/计时器等）：插件可能被多次加载，副作用应放进组件生命周期内并自行清理。

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
- [ ] `vite.config.ts` 的 external/globals 与 §3 完全一致（react/react-dom/react/jsx-runtime/@ttool/sdk）
- [ ] `npm run build` 成功产出 `dist/tool.js`，且 bundle **未打包** React（体积应很小）
- [ ] 只用了 §4 列出的 SDK 能力；配色全用 CSS 变量；持久化 key 带 id 前缀
- [ ] 顶层无副作用初始化
- [ ] 本地（开发者模式）安装后能在 TTool 启动台看到并打开、功能正常
