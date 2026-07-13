# TTool 截图 overlay 光标可见性优化

## Task State Projection

- status: worker_returned_to_merge_coordinator
- progress: Engineering + QA-lite completed in worker packet; CJS/geometry/typecheck/smoke/build checks passed.
- outputs: 截图 overlay 进入截图模式后使用高对比自绘准星显示鼠标位置；准星不接收 pointer events，并在工具条、输入框、handle 和选区边缘附近自动隐藏以保持原交互可读。
- next_action: Merge Coordinator 做最终 diff/记录核对，并安排手动 Electron 光标可见性 QA。

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
    end_time: 2026-07-09T16:32:41+08:00
    wall_clock_ms: unknown
    worker_runtime_ms: unknown

- cost:
    currency: unknown
    estimated_cost: unknown
    pricing_source: unavailable

## Node Completion Summary

- graph_root_id: 2026-07-09-screenshot-cursor-contrast-root
- node_id: 2026-07-09-screenshot-cursor-contrast-eng
- node_title: screenshot-cursor-contrast-Engineering-QA-lite
- stage: Engineering -> QA-lite
- status: stage_complete

## Changed Files

- `electron/main.cjs`
  - Added a high-contrast `#cursorReticle` inside screenshot overlay HTML/CSS: white crosshair lines, black outline, bright focus ring, and drop shadow.
  - Changed screenshot overlay crosshair mode to hide the low-contrast native cursor and track pointer position with the custom reticle.
  - Kept the reticle `pointer-events: none`; hides it over toolbar controls, text input, resize handles, and completed selection resize edges so selection boundaries and handles remain readable.
- `docs/codex/CODEX_TASK_REGISTRY.md`
- `docs/codex/TASK_OVERVIEW.md`
- `docs/codex/PROJECT_METRICS.md`
- `docs/codex/PROJECT_METRICS_LEDGER.md`
- `docs/codex/tasks/2026-07-09-screenshot-cursor-contrast.md`

## Validation

- `node --check electron/main.cjs` passed.
- `node scripts/screenshot-pin-geometry-test.mjs` passed.
- `npm run typecheck` passed.
- `npm run smoke` passed.
- `npm run build` passed.
- Static overlay inspection: `#cursorReticle` is DOM/CSS only, has `pointer-events: none`, follows `mousedown`/`mousemove`/`mouseup`/`dblclick`/`mouseenter`, and does not participate in existing hit testing.

## Manual QA

1. 启动 Electron 后进入 `screenshot-pin`，点击 `截图` 或使用截图快捷键；在未开始框选时移动鼠标，确认暗色半透明蒙版和复杂背景上都能清楚看到白/黑描边准星与亮色焦点环。
2. 在亮色、暗色、复杂背景上分别正向拖拽和反向拖拽选区，确认拖拽过程中准星持续跟随，选区尺寸 chip、边框和蒙版仍清楚。
3. 完成选区后靠近边缘和 8 个 handle，确认 resize cursor/handle 可读，拖动调整大小不受影响。
4. 使用 overlay 标注工具绘制箭头、矩形、圆形、画笔、文本和马赛克，确认准星不拦截绘制；双击选区仍能确认提交。
5. 点击工具条的复制、保存、贴图、取消和完成按钮，确认按钮 hover/click 正常；按 Esc 取消仍正常。

## Residual Risks

- 本 worker 未重启桌面 app 做真实视觉验收；需要按 Manual QA 在 Electron 运行态复验。
- 工作区在本任务开始前已有 `electron/main.cjs`、`package.json`、`src/components/SettingsPanel.tsx`、`src/tools/impl/screenshotPin.tsx`、`docs/codex/` 等脏状态；本次未回退 unrelated changes。
