# 工具开发与接入指南（插件式）

本平台采用**插件式工具系统**：每个工具是一个**自包含模块**，自己向注册表登记。
**新增/接入一个工具 = 往 `src/tools/impl/` 放一个文件（或一个文件夹）**，无需改动注册表、启动台、标签栏或任何中央清单。

> 适合「多个 agent 并行开发、完成后统一接入」：每个 agent 各自产出一个工具模块（互不依赖），
> 接入时把模块文件拷进 `src/tools/impl/` 即可——**没有共享文件需要同时编辑，天然无合并冲突**。

---

## 1. 一个工具长什么样

最小工具（单文件）：放在 `src/tools/impl/<id>.tsx`

```tsx
import { registerTool } from '@/tools/registry'
import { ToolPage, ToolHeader } from '@/tools/ui'
import { usePersistentState } from '@/store/persistentState'
import { useToolbox } from '@/store/toolbox'

function ReverseTool() {
  const { copy } = useToolbox()
  const [text, setText] = usePersistentState('reverse.text', 'Hello TTool')
  const reversed = [...text].reverse().join('')
  return (
    <ToolPage scroll>
      <ToolHeader glyph="⇄" hue="indigo" title="字符串反转" subtitle="把文本反向排列" />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ width: '100%', height: 96, borderRadius: 13, background: 'var(--surface2)', border: '1px solid var(--hair)', resize: 'none', padding: 15, fontSize: 15, color: 'var(--text)' }}
      />
      <div onClick={() => copy(reversed, '结果')} style={{ marginTop: 12, fontFamily: 'ui-monospace,monospace', color: 'var(--text)', cursor: 'pointer' }}>{reversed}</div>
    </ToolPage>
  )
}

registerTool({
  id: 'reverse',        // 全局唯一（也是路由 key / 持久化前缀）
  name: '字符串反转',
  desc: '把文本反向排列',  // 启动台列表里的副标题
  glyph: '⇄',           // 没有图标图片时显示这个字形
  cat: '文本',           // 分类（见 §4）
  hue: 'indigo',         // 图标配色（见 §4）
  order: 50,             // 可选：展示排序，越小越靠前；不写则排在已声明 order 的工具之后
  keywords: 'reverse fanzhuan',  // 可选：补充搜索词 / 拼音别名
  component: ReverseTool,
})
```

放进 `src/tools/impl/reverse.tsx` 后**刷新即生效**——自动出现在启动台列表、搜索（含拼音）、分类筛选，点击在标签页打开。

### 带资源的工具（文件夹形式）

需要自带图标等资源时，用文件夹：`src/tools/impl/<id>/index.tsx`，资源放同目录。

```
src/tools/impl/qrcode/
  index.tsx      ← 工具实现 + registerTool
  icon.png       ← 该工具的图标
```

```tsx
// src/tools/impl/qrcode/index.tsx
import icon from './icon.png'
// ...
registerTool({ id: 'qrcode', name: '二维码', icon, /* ... */ component: QrTool })
```

两种放法（`impl/<id>.tsx` 或 `impl/<id>/index.tsx`）都会被自动发现，可混用。

---

## 2. 自动发现机制（无需手动登记）

`src/tools/impl/index.ts` 用 Vite 的 `import.meta.glob` 急切导入 `impl/` 下所有工具模块：

```ts
const modules = import.meta.glob(['./*.tsx', './*/index.tsx'], { eager: true })
```

每个模块加载时执行 `registerTool()` 完成自注册。**你不需要编辑这个文件**。

展示顺序由各工具的 `order` 字段决定（升序、稳定），与文件名、加载顺序无关——
所以并行开发时各工具自带顺序，落盘后顺序自洽。建议 `order` 留间隔（10/20/30…）便于以后插入。

---

## 3. 工具可以用的共享能力（稳定 API）

工具只依赖下面这些，**不要直接 import electron / 直接碰 window.toolbox / 写死第三方协议**。

| 能力 | 来源 | 用途 |
| --- | --- | --- |
| `ToolPage` / `ToolHeader` / `Panel` / `Seg` / `ActionPill` / `MONO` | `@/tools/ui` | 与全局一致的工具页骨架与控件 |
| `usePersistentState(key, initial)` | `@/store/persistentState` | 跨标签切换保活的状态（代替 useState） |
| `useToolbox()` → `copy(text, label?)` / `flash(msg)` / `openTool(id)` | `@/store/toolbox` | 复制到剪贴板并提示 / 弹 Toast / 打开另一个工具 |
| `platform` → `copyText` / `openExternalApp` / `pickAppPath` / `translate` / `isDesktop` | `@/platform` | 跨运行时（web/electron/未来 tauri）的系统能力，已做降级 |
| `useNow()` | `@/store/useNow` | 每秒跳动的当前 Unix 秒（时钟类工具用） |
| 设计令牌 `var(--text)` / `var(--surface2)` / `var(--accent)` … | CSS（全局已注入） | 配色一律用变量，自动适配深/浅色 |

- 主体容器统一用 `<ToolPage scroll?>`：`scroll` 走可滚动布局，省略走纵向填充（两栏型）。
- 头部统一用 `<ToolHeader glyph icon? hue title subtitle right? />`。
- 状态需要在切换标签后保留 → 用 `usePersistentState('<id>.xxx', 初始值)`（key 以工具 id 前缀，避免冲突）。

---

## 4. 字段取值

- **id**：全局唯一，小写英文/数字；同时作为持久化 key 前缀。重复会被注册表忽略并告警。
- **cat（分类）**：内置 `开发` / `文本` / `时间` / `翻译` / `设计`。也可写**新分类**——筛选栏会自动出现该分类；某分类下 0 个工具时该标签自动隐藏。
- **hue（图标配色）**：`blue` / `purple` / `amber` / `teal` / `green` / `indigo` / `pink` / `gray`。
- **glyph**：无图标图片时显示的字形（emoji 或 1–2 个字符，如 `{}`、`◷`、`文A`）。
- **icon（可选）**：`import` 进来的图片 URL（整幅方形图，UI 会自动圆角）。没有就用 glyph。
- **order（可选）**：展示排序，越小越靠前。
- **keywords（可选）**：补充搜索词；中文名已自动支持拼音（全拼/首字母），这里可加英文别名或额外拼音。

---

## 5. 多 agent 并行开发 → 统一接入 的标准流程

1. **分发规格**：把本文件 + 一个工具 id 列表分给各 agent，每个 agent 负责一个工具。
2. **隔离开发**：每个 agent 产出**一个** `impl/<id>.tsx`（或 `impl/<id>/` 文件夹），只依赖 §3 的共享 API。
   - 各 agent 用**不同的 id**（避免冲突）；建议约定好 id 与 order 分配。
   - 可在各自的 git 分支/worktree 开发；因为不碰任何共享文件，互不冲突。
3. **统一接入**：把各 agent 的文件/文件夹拷进 `src/tools/impl/`，**不需要改任何中央文件**。
4. **验收**：
   - `npm run typecheck` —— 类型检查
   - `npm run build` —— 生产构建（会把所有工具一并打包，能据此确认都被发现）
   - `npm run smoke` —— 无浏览器 SSR 渲染冒烟，确认外壳 + 每个工具都能渲染不报错
   - 跑起来：`npm run dev`（浏览器）或 `npm run electron`（桌面），逐个点开验收

### 接入检查清单（每个工具）
- [ ] 文件在 `src/tools/impl/` 下，且 `id` 全局唯一
- [ ] `registerTool({...})` 字段齐全（id/name/desc/glyph/cat/hue/component）
- [ ] 只用 §3 的共享 API，没有直接 import electron / 没有写死第三方密钥或协议
- [ ] 需要保活的输入用 `usePersistentState('<id>.xxx', …)`
- [ ] `npm run typecheck && npm run build && npm run smoke` 全绿

---

## 6. 进阶：跨仓库 / 独立包分发（可选）

若希望工具完全独立成包（不同团队各自发版）：把工具发布为 npm 包，包入口调用 `registerTool`，
宿主在启动时 `import 'your-tool-pkg'` 触发注册即可（与本地文件接入同理，只是来源是包）。
绝大多数"几个 agent 开发后统一接入"的场景，**直接落 `impl/` 文件是最轻量、零配置的方式**，推荐优先用它。

---

## 7. 内置工具：截图贴图

`screenshot-pin` 是桌面端专用内置工具，不属于外部插件 SDK 能力。它通过内部截图 bridge 访问 Electron 截图、贴图窗口、剪贴板和保存能力；外部插件运行时不可通过 `TToolSDK.platform.screenshot` 获取截图 API。

当前工具页布局为顶部状态操作栏 + 三栏工作区：

- 顶部状态操作栏：左侧为精简状态摘要，中间为 `截图` / `截图并贴图` 两条快捷键设置，右侧为启用开关、`截图` 和 `截图并贴图` 主操作。
- 左侧：文件持久化截图历史，按 100 条 / 128 MB 双上限保留，支持收藏、软删除/恢复和快速保存。
- 中间：居中的 `AnnotationEditor`，作为截图标注主工作区。
- 右侧：当前贴图列表，支持聚焦、缩放、透明度、旋转/翻转、锁定、鼠标穿透、隐藏/缩略、标注、复制、保存与关闭；图片、窗口位置和状态会安全持久化并在重启后恢复。
- 快捷键配置直接外置在顶部状态操作栏中间，不再通过截图贴图页内的 `设置` 按钮进入；仍复用原有启用/录制/重置/注册状态数据流。

响应式规则：宽窗口使用三栏；中等宽度优先保留编辑器，最近截图和当前贴图下移并列；窄窗口降为单列，避免挤压标注区域。

截图与标注交互要点：

- 普通 `截图` 完成后先把截图图片写入系统剪贴板，再创建 latest-only 右下角浮窗，不立即打开工具页；点击浮窗、open button 或键盘确认才打开 `AnnotationEditor`。浮窗 5 秒无操作关闭，hover/focus 暂停倒计时，关闭按钮 click/Enter/Space 只关闭。`截图并贴图` 路径仍直接创建 pin，不显示普通截图浮窗。
- 开始框选前会严格按 `display_id` 抓取每个显示器的一份不可变 CaptureFrame；遮罩和裁剪复用同一 PNG。坐标转换显式经过显示器 DIP、overlay CSS viewport、实际渲染图像矩形和帧像素，混合缩放、负坐标、竖屏及边缘裁剪必须走同一转换核心。
- overlay HTML 保持小型化，冻结 PNG 通过 preload 二进制 IPC + Blob URL 注入；框选层提供放大镜、像素坐标与 HEX/RGB/HSV、十字线、Shift 约束、方向键微调和当前屏全选。
- `AnnotationEditor` 进入时默认使用 `适配` 视图；用户手动缩放/平移后进入 manual 状态，`适配` / `100%` / `-` / `+` / Ctrl/Meta wheel 只改变视图，不改变导出坐标。
- 标注类型包含箭头、直线、矩形、圆形、画笔、荧光笔、文本、编号、橡皮擦和涂抹式马赛克。`选择` 模式支持点选或框选标注，选中对象可拖动、用方向键微调或按 Del/Backspace 删除；文本输入聚焦时 Delete/Backspace/Esc 不删除图层，工具和样式偏好保存在本地。
- `electron/screenshot-history.cjs` 只接受安全 ID 与受控根目录，使用同目录原子 metadata 写入并限制条数/容量；`electron/screenshot-pin-state.cjs` 是无 Electron 副作用的纯状态归一化/转换核心。上述能力仍只通过 first-party preload surface 供内置工具使用，不进入插件 SDK。
- 矩形和圆形支持 `携带文本`。勾选后绘制形状会追加文本输入并自动聚焦；Enter/blur 提交，Esc 或空文本只取消文本，不删除形状；形状和提交文本作为同一 undo 分组。

---

## 8. 内置工具：Codex 用量状态

`codex-usage` 是桌面端 first-party 工具，通过本机已安装、已登录的 `codex app-server` 读取 `account/rateLimits/read` 与 `account/usage/read` 快照；它不读取、保存或显示 Codex 登录凭据、对话内容或提示内容，也不属于外部插件 SDK 能力。

- 打开工具页、手动显示状态窗或启用“常驻”时才按需启动 App Server；未启用常驻且离开工具页时会停止子进程。
- “刷新”会等待新的限额和用量快照；页面与状态窗显示上次成功刷新时间，并在两分钟后标记数据可能过期。读取失败时保留最后快照并显示可恢复错误。
- 常驻状态窗默认在主显示器右下角、置顶且不显示在任务栏。它是可交互窗口：可从顶部“拖动此处”移动，并通过工具页的不透明度控件调节透明度；关闭常驻立即销毁窗口并停止子进程。
- token 趋势支持近 7 / 30 天视图，柱条和摘要使用紧凑的 `K` / `M tokens`，悬停、聚焦或点击柱条可查看完整数值。
- 本机未安装 Codex CLI、尚未登录或接口暂不可用时，工具只显示可恢复的错误状态，不会要求输入或暴露任何凭据。

---

## 9. 内置工具：图片处理

`image-tool` 是 renderer-only 的内置图片工具，使用浏览器 File / Image / Canvas / Object URL 能力完成处理，不调用 Electron API、不上传源文件，也不扩展外部插件 SDK。

- 支持文件选择与拖放导入常见栅格图片，显示原文件名、格式、尺寸和体积；动态 GIF 等动画输入只处理静态首帧。
- 可锁定原始宽高比或自由输入目标宽高，并执行 90° 旋转、水平翻转、垂直翻转和一键重置。
- 输出格式为 PNG、JPEG、WebP；JPEG/WebP 可调质量，JPEG 的透明区域可用用户选择的背景色填充。
- 处理结果提供实际输出尺寸与格式信息，并以不覆盖源文件的新文件名下载。
- 输入上限为 50 MiB、单边 16384 px；输出画布上限为 4000 万像素。错误或不支持的文件必须显示可恢复提示，不能让整个工具页或应用白屏。
- 对象 URL 在源图替换、结果替换和组件卸载时释放；SSR 初始渲染不得访问 `window`、`document`、`Image` 或其他仅浏览器存在的全局对象。
- 当前版本不承诺保留动画、EXIF/ICC 等元数据，也不包含裁剪、批处理、标注或桌面原生编码器；这些能力需作为独立范围评估。
