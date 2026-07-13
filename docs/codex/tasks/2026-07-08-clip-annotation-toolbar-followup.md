# TTool 截图/普通剪辑标注工具栏跟进修复

## Task State Projection

- status: worker_returned_to_merge_coordinator
- progress: Engineering + QA-lite completed; focused and full project checks passed.
- outputs: overlay 标注工具补齐到核心标注类型；标注模式下双击选区可确认提交；普通 clip 默认复制合成图且不进入 `screenshot-pin` 工具页；独立标注编辑器工具栏移到底部。
- next_action: Merge Coordinator 做最终 diff/记录核对，并安排手动 Electron QA。

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
    end_time: 2026-07-08T18:11:52+08:00
    wall_clock_ms: unknown
    worker_runtime_ms: unknown

- cost:
    currency: unknown
    estimated_cost: unknown
    pricing_source: unavailable

## Node Completion Summary

- graph_root_id: 2026-07-08-clip-annotation-toolbar-followup-root
- node_id: 2026-07-08-clip-annotation-toolbar-followup-eng
- node_title: clip-annotation-toolbar-followup-Engineering-QA-lite
- stage: Engineering -> QA-lite
- status: stage_complete

## Changed Files

- `electron/main.cjs`
  - Added overlay tools for select, arrow, rectangle, circle, brush, text, mosaic, color/size controls, undo/redo/clear.
  - Kept double-click submit active while annotation tools are selected; double-click no longer creates committed zero-size annotations.
  - Normalized and composited overlay annotations into the final cropped PNG for copy/save/pin/default edit actions.
  - Preserved ordinary clip default path as direct copy of the composited image, without opening `screenshot-pin`.
- `src/tools/impl/screenshotPin.tsx`
  - Moved independent annotation editor controls below the canvas.
  - Added wrapping bottom toolbar layout and button/chip overflow guards.
- `docs/codex/CODEX_TASK_REGISTRY.md`
- `docs/codex/TASK_OVERVIEW.md`
- `docs/codex/PROJECT_METRICS.md`
- `docs/codex/PROJECT_METRICS_LEDGER.md`
- `docs/codex/tasks/2026-07-08-clip-annotation-toolbar-followup.md`

## Validation

- `node --check electron/main.cjs` passed.
- `node scripts/screenshot-pin-geometry-test.mjs` passed.
- `npm run typecheck` passed.
- `npm run smoke` passed.
- `npm run build` passed.

## Deferred Tool List

- overlay `pan` / canvas viewport drag: deferred because the overlay is a full-screen native selection surface with no zoomed image viewport to pan.
- overlay individual annotation selection/move/delete and shape `携带文本`: deferred to avoid turning the transient overlay into the full React editor; overlay now covers the editor's core annotation types and undo/redo/clear operations.

## Manual QA

1. 普通 `截图`：拖拽选区，分别画箭头、矩形、圆形、画笔、文本、马赛克，双击选区确认，确认剪贴板图片包含标注且未打开 `screenshot-pin` 工具页。
2. 普通 `截图`：不画标注，直接双击选区确认，确认复制成功。
3. 反向拖拽矩形/圆形，确认预览和最终图片宽高方向正确。
4. 打开独立标注编辑器，确认工具栏位于画布底部，画布可滚动/缩放，按钮文本不溢出。
5. 点击主窗口关闭，确认默认最小化/隐藏到托盘且不弹窗。

## Residual Risks

- 本 worker 未重启桌面 app 做真实鼠标验收；需要按 Manual QA 在 Electron 运行态复验。
- 工作区在本任务开始前已有多处 dirty/untracked 文件；本次未回退 unrelated changes。
