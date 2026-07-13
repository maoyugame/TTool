# TTool 剪辑内联标注与关闭默认最小化

## Task State Projection

- status: worker_returned_to_merge_coordinator
- progress: Engineering completed; focused checks passed.
- outputs: 普通截图/clip 选区完成后停留在 overlay/region 内直接画矩形/圆形标注；默认 edit 完成复制合成后的图片，不进入 `screenshot-pin` 工具页或主窗口标注编辑器；主窗口关闭默认隐藏到托盘，显式托盘退出仍真正退出。
- next_action: Merge Coordinator 做最终 diff/记录核对，并进入用户验收或 scoped commit gate。

## Observability

- telemetry:
    source: unavailable
    scope: current worker packet
    confidence: unavailable

- tokens:
    input: unknown
    output: unknown
    total: unknown

- duration:
    start_time: unknown
    end_time: 2026-07-08
    wall_clock_ms: unknown
    worker_runtime_ms: unknown

- cost:
    currency: unknown
    estimated_cost: unknown
    pricing_source: unavailable

## Node Completion Summary

- graph_root_id: 2026-07-08-clip-inline-annotation-minimize-root
- node_id: 2026-07-08-clip-inline-annotation-minimize-eng
- node_title: clip-inline-annotation-and-close-minimize-Engineering
- stage: Engineering
- status: stage_complete

## Changed Files

- `electron/main.cjs`
  - Added inline overlay rectangle/circle annotation controls and selection-local annotation state.
  - Normal `edit` completion now composites inline annotations into the captured PNG and copies it, without calling `deliverCaptureToEditor()`.
  - Kept `pin`, `copy`, and `save` actions on the overlay; `pin` still creates a pin window from the composited image.
  - Changed main-window close handling to call `hideMainWindowToTray()` directly, with tray menu `退出 TTool` preserving real quit.
- `docs/codex/CODEX_TASK_REGISTRY.md`
- `docs/codex/TASK_OVERVIEW.md`
- `docs/codex/PROJECT_METRICS.md`
- `docs/codex/PROJECT_METRICS_LEDGER.md`

## Validation

- `node --check electron/main.cjs` passed.
- `node scripts/screenshot-pin-geometry-test.mjs` passed.
- `npm run typecheck` passed.
- `npm run smoke` passed.

## QA Sidecar Self-Check

- 普通 clip 不会进入 `screenshot-pin` 工具页/主窗口编辑器；`completeOverlaySelection()` 的 default `edit` 分支不再调用 `deliverCaptureToEditor(capture)`。
- `deliverCaptureToEditor()` 保留给贴图窗口“标注”和已有截图浮窗打开编辑器等非普通 clip 默认路径。
- `overlayHtml()` 工具条提供 `矩形`、`圆形`、`撤销`、`清除`，标注发生在当前选区内。
- `requestMainWindowClose()` 不再调用 `dialog.showMessageBox`；主窗 `close` 事件默认隐藏到托盘。
- `截图并贴图` 仍走 `createPinWindow()`；贴图窗口里的“标注”仍走 `annotatePin()`。

## Manual QA

1. 启动 Electron 后触发普通 `截图`，拖拽选区，松开后留在 overlay。
2. 在选区内用默认 `矩形` 向任意方向拖拽画框，再点 `圆形` 从右下向左上反向拖拽画圆，确认预览和提交形状正常。
3. 点击 `✓` 或 `复制`，确认不会打开 TTool 主窗口里的 `screenshot-pin` 页面，剪贴板图片包含标注。
4. 触发 `截图并贴图`，确认仍创建贴图；在贴图窗口点击 `标注`，确认既有独立编辑入口仍可用。
5. 点击主窗口关闭按钮，确认无“是否最小化”确认框且窗口隐藏；从托盘菜单点 `显示 TTool` 可恢复，点 `退出 TTool` 会真正退出。

## Residual Risks

- 本 worker 未做真实 Electron 鼠标自动化；需按 Manual QA 做桌面实测。
- 当前工作区在本次开始前已有 `electron/main.cjs`、`package.json`、`src/components/SettingsPanel.tsx`、`src/tools/impl/screenshotPin.tsx`、`docs/codex/` 等脏状态；本次未回退 unrelated changes。
