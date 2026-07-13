# TTool 剪辑标注反向框选与直接标注修复

## Task State Projection

- status: worker_returned_to_merge_coordinator
- progress: Engineering + QA-lite completed in worker packet; scoped checks passed.
- outputs: 矩形/圆形标注预览与提交支持任意拖拽方向；普通截图 edit 选区完成后直接打开标注编辑器。
- next_action: Merge Coordinator 做最终 diff/记录核对，并进入用户验收或 commit gate。

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

- graph_root_id: 2026-07-08-clip-annotation-reverse-select-root
- node_id: 2026-07-08-clip-annotation-reverse-select-eng
- node_title: clip-annotation-reverse-select-Engineering-QA-lite
- stage: Engineering -> QA-lite
- status: completed

## Changed Files

- `src/tools/impl/screenshotPin.tsx`
  - draw interaction now keeps the initial pointer-down point as the shape anchor.
  - rectangle/circle draw, hit-test, bounds, validation, text placement, and commit paths normalize rect geometry.
- `src/tools/impl/screenshotPinGeometry.ts`
  - Added reusable geometry helpers for point-to-rect, negative width/height normalization, and anchored drag shapes.
- `electron/main.cjs`
  - Normal `edit` capture completion now delivers the cropped image directly to the annotation editor instead of requiring the completion toast click.
- `scripts/screenshot-pin-geometry-test.mjs`
  - Added focused pure-function coverage for forward drag, reverse upper-left drag, stable drag anchor, and negative geometry normalization.

## Validation

- `node scripts/screenshot-pin-geometry-test.mjs` passed.
- `npm run typecheck` passed.
- `npm run smoke` passed.

## Residual Risks

- Desktop UI interaction was not automated end-to-end; manual QA should verify actual pointer behavior in Electron.
- `electron/main.cjs`, `package.json`, `src/components/SettingsPanel.tsx`, `docs/codex/`, and other untracked assets already had unrelated dirty state before this worker.
