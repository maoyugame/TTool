# TTool 截图贴图工具页三栏布局与顶部状态操作栏

## 背景

用户确认新的截图贴图工具页布局方向：

- 状态与操作信息放到顶部，不再单独占一列。
- 标注编辑器居中，作为主工作区。
- 左侧放最近截图。
- 右侧放当前贴图。
- 快捷键不常驻占位，放在右上方 `设置` 按钮内。

本规格只覆盖工具页布局和信息架构调整，不改变截图 overlay、标注编辑器模型、pin window 生命周期、SDK 边界或桌面能力抽象。

## 目标

- 让标注编辑器成为第一视觉中心。
- 让最近截图和当前贴图成为左右辅助栏，形成“素材 -> 编辑 -> 贴图管理”的工作台。
- 把低频快捷键配置收进设置入口，减少常驻信息占位。
- 保持所有已接受能力：最近 5 张、pin 操作、选择/拖拽/缩放、文本标注、涂抹式马赛克、overlay 无 `标注`、SDK screenshot 非暴露。

## 新 IA

### 顶部 StatusActionBar

顶部横向区承载全局状态、主要操作和设置入口。

左侧信息：

- 标题：`截图贴图`。
- 状态 chip：启用/关闭、桌面运行时、权限、显示器数量。
- 快捷键状态只做摘要，例如 `截图快捷键已注册`、`贴图快捷键已注册`、`部分快捷键不可用`。
- 最近状态/错误文案继续显示在顶部区域内，例如 `截图已取消`、`截图进行中`、`快捷键被占用`。

右侧操作：

- 启用开关。
- `截图`、`截图并贴图`。
- `设置` 按钮，打开快捷键与偏好设置。

顶部不再常驻完整快捷键配置表。

### 左侧最近截图栏

左栏只放最近截图。

- 标题：`最近截图`，右侧显示 `n/5`。
- 最多 5 张，保持内存队列和第 6 张移除最旧项的现有语义。
- 建议纵向紧凑卡片：
  - 缩略图 72x48 到 88x58。
  - 尺寸，例如 `456 x 314px`。
  - 创建时间。
  - 操作：`打开`、`贴图`、`复制`、`删除`。
- 空状态：`暂无最近截图`，可提供小按钮 `截图`。
- 宽度建议 240-280px；1366 宽度下建议 240px。

### 中间标注编辑器工作区

中间是主工作区，承载 `AnnotationEditor` 或空状态。

- 标注编辑器居中并占据最大空间。
- Panel label 仍为 `标注编辑器` 或 `标注贴图`。
- 空状态高度建议 220-260px，避免空编辑器像大块占位。
- 有截图时，canvas 区域优先分配空间。
- 保留现有选择、框选、多选移动、删除、拖拽平移、缩放、文本、涂抹式马赛克。
- 底部操作 `复制`、`保存`、`贴图/更新贴图`、`取消` 保持现有路径。

### 右侧当前贴图栏

右栏只放当前贴图。

- 标题：`当前贴图`，多于 1 个时保留 `关闭全部`。
- 卡片密度与左栏接近，但操作更多：
  - 缩略图 72x48 到 88x58。
  - 尺寸与创建时间。
  - 操作：`聚焦`、`隐藏/显示`、`标注`、`复制`、`保存`、`关闭`。
- 空状态：`当前没有贴图`，提供 `截图并贴图`。
- 宽度建议 260-320px；1366 宽度下建议 260px。

## 快捷键设置入口

设置入口建议使用轻量 panel、popover 或 drawer。优先选择工程成本最低、最贴合现有 `Panel` 风格的实现。

触发规则：

- 点击顶部右上 `设置` 打开。
- 再次点击 `设置` 或点击面板内 `关闭` 收起。
- Esc 关闭设置面板；若正在录制快捷键，Esc 优先取消录制。

设置内容：

- 功能开关：启用/关闭。
- 两行快捷键配置：
  - `截图`
  - `截图并贴图`
- 每行包含当前组合、`录制`、`重置`、注册状态。
- 保留冲突、注册失败、禁用态逻辑：
  - 功能关闭时显示 `已停用`，允许编辑但不注册。
  - 注册失败保留上一个有效快捷键。
  - 录制态建议显示 `按下新的快捷键`。

推荐实现：

- 新增 `settingsOpen` state。
- 复用现有 `ShortcutPanel` / `ShortcutRow` 内容，不重写快捷键逻辑。
- 宽屏下设置面板右对齐，宽度 360-420px。
- 720px 以下设置面板在顶部下方全宽展示。

## 响应式布局

### 1440px 以上

```text
Top StatusActionBar

Recent Sidebar | Center Editor Workspace | Pins Sidebar
260-280px      | minmax(520px, 1fr)      | 300-320px
```

三列同时展示，中间列最大。

### 1366px 左右

```text
Recent Sidebar | Center Editor Workspace | Pins Sidebar
240px          | minmax(480px, 1fr)      | 260px
```

三列仍可展示。左右栏按钮允许换行，但不能溢出卡片。

### 980px 到 1200px

优先保证编辑器宽度。

建议策略：

- 如果中间列仍可保持 460px 以上，继续三列紧凑展示。
- 如果编辑器低于 460px，切到两行：
  - 第一行：Editor Workspace。
  - 第二行：Recent 与 Pins 两列。

### 720px 以下

单列顺序：

1. Top StatusActionBar。
2. Editor Workspace。
3. Recent Sidebar。
4. Pins Sidebar。

要求：

- 无横向滚动。
- 顶部按钮可换行。
- 设置面板全宽显示。
- 最近截图和当前贴图卡片变为单列紧凑行。

## Visual / Token 约束

- 复用 `ToolPage`、`ToolHeader`、`Panel`、`Chip`、`Button` 和现有 CSS tokens。
- 不新增 icon、mockup、raster asset、SVG 资产或新依赖。
- UI 颜色继续使用 `var(--text)`、`var(--text2)`、`var(--text3)`、`var(--surface2)`、`var(--surface3)`、`var(--hair)`、`var(--field)`、`var(--accent)`。
- 不做 hero、插画、装饰渐变或大面积视觉资产。
- 卡片圆角沿用现有 10-12px。

## Engineering Notes

当前实现已有这些可复用结构：

- `StatusActionBar`
- `RecentScreenshotsPanel`
- `AnnotationEditor`
- `EmptyEditor`
- `PinsPanel`
- `ShortcutPanel`

建议低风险实现路线：

1. 将当前两列 `.screenshot-pin-grid` 调整为三栏工作台。
2. 顶层顺序改为：
   - `StatusActionBar`
   - `screenshot-pin-workbench`
     - `screenshot-pin-left` -> `RecentScreenshotsPanel`
     - `screenshot-pin-center` -> `AnnotationEditor` / `EmptyEditor`
     - `screenshot-pin-right` -> `PinsPanel`
3. 从右侧常驻列移除 `ShortcutPanel`。
4. 在 `StatusActionBar` 或其下方通过 `settingsOpen` 渲染设置面板。
5. 不改变 `config`、`statuses`、`recording`、`saveShortcut` 的现有数据流。
6. 不改变 `AnnotationEditor` 的数据结构、undo/redo、选择/拖拽/缩放、export 路径。
7. 不改变 pin/recent platform API。

## 必须保持的行为

- 最近截图最多 5 张，超过移除最旧项，重启清空仍为 v1 预期。
- 最近截图支持打开、贴图、复制、删除。
- 当前贴图支持聚焦、隐藏/显示、标注、复制、保存、关闭、关闭全部。
- 标注编辑器支持选择、框选、多选移动、Del/Backspace 删除、拖拽平移、缩放、文本标注、涂抹式马赛克。
- overlay 完成态工具条没有 `标注`。
- 正常截图 `✓` / 双击进入 AnnotationEditor；截图并贴图 `✓` / 双击创建 pin。
- 外部插件可见 `TToolSDK.platform` 不暴露 screenshot API。

## QA 清单

- 1920px：顶部状态与操作清晰，三列清楚，编辑器居中且最大。
- 1366px：左最近截图、中编辑器、右当前贴图均可见，按钮无溢出。
- 约 980px：进入紧凑策略后编辑器不被挤压。
- 约 720px 以下：单列顺序为顶部、编辑器、最近截图、当前贴图，无横向滚动。
- `设置` 可以打开/关闭；快捷键录制、重置、启用/关闭、冲突/注册失败状态可见。
- 最近 5 张和当前 pin 操作全部可用。
- 标注编辑器文本、马赛克涂抹、选择/移动/删除、拖拽平移、缩放无回归。
- 截图 overlay 底部无 `标注`，按钮不因 bridge 缺失冻结。
- copy/save/pin/update/export 不包含 selection UI，仍按原图坐标导出。
- SDK screenshot 仍未暴露给插件可见 `TToolSDK.platform`。
- 无新增视觉资产、无新依赖。

## Deferred

- 不做完整图层面板。
- 不做对象 resize / rotate。
- 不做最近截图跨重启持久化。
- 不重做 overlay 视觉。
- 不改变 pin window 工具栏。
