# TTool 截图贴图工具页三栏布局优化
## Task State Projection

- status: legacy-record-migrated
- progress: Legacy task record preserved; original Index / stage evidence remains below.
- outputs: Existing task record contents retained without destructive rewrite.
- next_action: Use CODEX_TASK_REGISTRY.md and TASK_OVERVIEW.md for current follow-up state.

## Observability

- telemetry:
    source: unavailable
    scope: unknown
    confidence: unavailable

- tokens:
    input: unknown
    output: unknown
    total: unknown

- duration:
    start_time: unknown
    end_time: unknown
    wall_clock_ms: unknown
    worker_runtime_ms: unknown

- cost:
    currency: unknown
    estimated_cost: unknown
    pricing_source: unavailable


## Index

- date: 2026-07-03
- status: terminal; desktop restarted for user acceptance; commit gate pending
- owner: PM - 项目经理
- pipeline: TTool 截图贴图 v1 / tool page layout redesign after user acceptance
- context_mode: lite
- plan_first: short-plan
- goal_mode: no
- goal: 将截图贴图工具页调整为顶部状态操作栏、左侧最近截图、中间标注编辑器、右侧当前贴图，并把快捷键设置收进右上设置入口。
- done_when: DesignArt 规格、Engineering 实现、QA 验收完成，桌面端重启供用户验收。
- task_thread: multiple stage threads
- previous_thread_id: 019f2715-1caa-70b0-8bc4-a3555b4e9650
- archive_status: completed-stage-threads-archived; docs-thread-unresponsive-pm-direct-sync
- archived_at: n/a
- archive_reason: n/a
- restore_policy: archive stage Task Threads after completion callback and PM record update

## Pipeline / Route Summary

Pipeline Decision:

- Request summary: 用户确认截图贴图工具页可以改为顶部承载状态/操作，标注编辑器居中，左侧最近截图，右侧当前贴图，快捷键通过右上设置按钮进入。
- Task classification: UI/UX layout polish after user acceptance。
- Execution path: fast-lane-lite with DesignArt -> Engineering -> QA -> PM。
- Pipeline template: UI polish = DesignArt -> Engineering -> QA -> Docs if needed -> PM。
- Current stage: PM terminal; desktop restarted for user acceptance。
- Imagegen-only art gate: not-needed；本任务只改布局/交互，不生成视觉资产。
- User input required: no。

Route Decision:

- Target role_tag: DesignArt。
- Target employee: Mia - UI美术。
- Execution surface: Task Thread。
- Target Task Thread title/id: 截图贴图三栏布局优化-Mia-UI美术 / `019f2753-41ba-76a3-a45f-c66724eb0127`。
- Isolation: same-directory Task Thread for docs/spec stage。
- Acceptance strategy: Engineering-ready layout spec plus responsive/functional QA checklist。
- Completion callback: PM thread `019f220a-9067-7173-b2e6-743524ff2b22`。
- Inbox fallback: `docs/codex/THREAD_EVENT_INBOX.md`。

## Stage Threads

- DesignArt: Mia - UI美术 / `019f2753-41ba-76a3-a45f-c66724eb0127` / stage-complete。
- Engineering: Alex - 研发 / `019f2758-9bab-79f3-9a85-befefeca1d39` / stage-complete; archived。
- QA: Emma - 测试 / `019f2761-f60b-70d2-8280-38bf5961888d` / stage-complete。

## Requirements

- 状态与操作信息放到顶部，不再单独占一列。
- 标注编辑器居中，作为主工作区。
- 左侧展示最近截图。
- 右侧展示当前贴图。
- 快捷键设置收进右上方设置按钮。
- 保留现有功能：最近 5 张截图、当前贴图管理、快捷键启停/录制/重置/状态反馈、标注选择/移动/删除/拖拽/缩放、文本、马赛克涂抹、overlay 无 `标注`、SDK screenshot 非暴露。

## Deliverable

- Engineering-ready DesignArt spec: `docs/codex/design/screenshot-pin-three-column-layout.md`。
- Engineering implementation target: `C:\Users\123\.codex\worktrees\fae0\tool\src\tools\impl\screenshotPin.tsx`。
- Local validation helper: `C:\Users\123\.codex\worktrees\fae0\tool\.verify\screenshot-pin-three-column-smoke.cjs`。

## Key Decisions

- 采用三栏工作台：左最近截图、中间标注编辑器、右当前贴图。
- 顶部 `StatusActionBar` 承载状态摘要、启用开关、主操作和 `设置` 入口。
- 快捷键设置从常驻右侧 panel 改为右上设置入口内的轻量 panel/popover/drawer，复用现有快捷键录制、重置、状态逻辑。
- 响应式优先保护编辑器宽度；窄屏下单列顺序为顶部、编辑器、最近截图、当前贴图。
- 不改变 overlay、AnnotationEditor 数据模型、pin/recent platform API 或 SDK 边界。

## Engineering Changes

- Updated the user-facing repaired target `C:\Users\123\.codex\worktrees\fae0\tool` only for business code.
- Reworked `screenshotPin.tsx` from the prior two-column page into:
  - top `StatusActionBar` with status chips, enable toggle, `截图`, `截图并贴图`, and `设置`;
  - left `RecentScreenshotsPanel`;
  - centered `AnnotationEditor` / `EmptyEditor` workspace;
  - right `PinsPanel`;
  - settings panel opened from `设置`, reusing existing `config/statuses/recording/saveShortcut` data flow.
- Removed the always-visible right-side `ShortcutPanel`; shortcut controls now live in the settings panel.
- Added responsive layout behavior:
  - 1440+ and 1366 widths: three columns;
  - around 980 width: editor spans the first row, recent/pins share the second row;
  - below 760 width: single-column order top, editor, recent screenshots, current pins.
- Preserved recent 5 screenshots, pin actions, text annotation, brush mosaic, selection/move/delete, pan/zoom, overlay bridge fallback, overlay without `标注`, and SDK screenshot non-exposure.

## Validation

- PASS DesignArt inspection: read project `AGENTS.md`, `docs/codex/ROUTING_RULES.md`, current registry, prior screenshot-pin layout and annotation editor task records。
- PASS current implementation inspection: reviewed repaired target `C:\Users\123\.codex\worktrees\fae0\tool\src\tools\impl\screenshotPin.tsx` for existing `StatusActionBar`, `RecentScreenshotsPanel`, `AnnotationEditor`, `PinsPanel`, and `ShortcutPanel` structure。
- PASS docs-only constraints: no business-code edits, no visual assets generated。
- PASS targeted trailing-whitespace scan on edited DesignArt files; keyword inspection covered three-column layout, `StatusActionBar`, settings, recent screenshots, current pins, `AnnotationEditor`, responsive behavior, overlay `标注`, and SDK boundary。
- PASS `npm run typecheck` in `C:\Users\123\.codex\worktrees\fae0\tool` with `D:\project\tool\node_modules\.bin` on PATH。
- PASS `npm run build` in repaired target。
- PASS `npm run smoke` in repaired target (`REGISTERED 4 : translate,screenshot-pin,json,timestamp`; SSR OK 5 targets)。
- PASS `node --check electron/main.cjs`; PASS `node --check electron/preload.cjs`; PASS `node --check .verify/screenshot-pin-three-column-smoke.cjs`。
- PASS SDK exposure grep/source check: no plugin-visible screenshot API matches。
- PASS targeted three-column layout smoke report `ok=true`: 1440/1366 widths are three columns, 967 width is two-column compact with editor first row, 693 width is single column, no body horizontal overflow, recent/pin cards visible, shortcut panel no longer inline in right rail, settings panel opens with shortcut rows/record/close controls。
- PASS targeted trailing-whitespace scan on edited business file and validation helper。
- PASS QA white-box checks in actual target `C:\Users\123\.codex\worktrees\fae0\tool`: `npm run typecheck`, `npm run build`, `npm run smoke`, `node --check electron/main.cjs`, `node --check electron/preload.cjs`。
- PASS QA SDK boundary check: no plugin-visible `platform.screenshot`, `screenshot?: ScreenshotApi`, `screenshot: bridge.screenshot`, or `TToolSDK.platform.screenshot` matches。
- PASS QA no-new-visual-assets check: source asset scan found only existing `src/assets/icons/json.png`, `src/assets/icons/timestamp.png`, and `src/assets/icons/translate.png`。
- PASS QA layout report `C:\Users\123\.codex\worktrees\fae0\tool\.verify\screenshot-pin-three-column-smoke.json`: 1427px and 1352px use 3 columns with left/center/right visible and no overflow; 967px uses 2 columns with editor prioritized and recent/pins visible; 693px uses 1 column with no overflow; settings panel opens and includes shortcut row, record control, and close control。
- PASS QA overlay bridge regression smoke: no TypeError with no preload/no `window.ttool`; `✓`, double-click, toolbar `贴图`, toolbar `复制`, `取消`, Esc, and invalid `3x3` selection route safely; overlay still has no `标注` button。
- PASS QA functional regression spot-check by helper/source review: top `截图` and `截图并贴图` still call `startCapture('edit')` / `startCapture('pin')`; recent 5 and open/pin/copy/delete remain wired; current pin focus/hide/show/annotate/copy/save/close/close-all remain wired; AnnotationEditor text, brush mosaic, selection/move/delete, pan/zoom logic remains present。

## Risks

- 实现阶段必须在当前 repaired target 中处理业务代码，`C:\Users\123\.codex\worktrees\fae0\tool` 仍是 non-Git partial target，commit gate 后续需单独 reconcile。
- 布局调整需重点验证 1920/1366/约 980/约 720 宽度下无文字溢出或编辑器被挤压。
- QA 已通过；剩余环境限制仍是前序记录中的原生保存 dialog 安全落盘、真实剪贴板图片读回、物理跨屏精确拖拽，不是本轮三栏布局实现缺陷。
- Final visual polish 仍建议 PM/用户在重启后的真实窗口尺寸下看一眼，但 QA 未发现需要回流 Alex 的实现缺陷。

## QA Dispatch

- QA thread: `019f2761-f60b-70d2-8280-38bf5961888d` / 截图贴图三栏布局优化-Emma-测试。
- QA owner: Emma - 测试。
- QA scope: three-column layout responsiveness, settings shortcut flow, recent/pin/editor regressions, overlay bridge/no `标注`, SDK boundary, and no visual assets。
- QA result: stage-complete / pass。

## QA Acceptance

- Acceptance decision: pass。
- White-box: PASS typecheck/build/smoke/CJS checks/SDK boundary/no-new-visual-assets。
- Layout evidence: `.verify/screenshot-pin-three-column-smoke.json` reports `ok=true`; 1427px and 1352px are 3 columns, 967px is 2-column compact fallback with editor priority, 693px is single column, all with no body overflow and left/center/right content visible.
- Settings evidence: settings panel opens from top `设置` and includes shortcut row, record control, and close control.
- Overlay evidence: `.verify/overlay-bridge-smoke.cjs` passes no-preload/no-`window.ttool` actions without TypeError; overlay buttons are `复制/保存/贴图/取消/✓`, invalid small selection disables actions and shows `选区过小`。
- Regression evidence: recent/pin actions and AnnotationEditor text/mosaic/selection/pan/zoom paths remain wired; top `截图` / `截图并贴图` still call the expected capture routes.

## Follow-up

- 用户验收三栏布局；commit gate 后续单独处理。

## Docs Update

- Docs sync path: PM direct docs-only update after Olivia Task Thread stayed active without progress beyond its opening message.
- Files updated: `README.md`, `TOOLS.md`, `docs/PROJECT_BRIEF.md`, `docs/TASKS.md`, `docs/DECISIONS.md`, registry/task/memory records。
- Content synced: top status/action bar, left recent screenshots, centered annotation editor, right current pins, right-top settings entry for shortcuts, responsive wide/medium/narrow behavior, and SDK screenshot non-exposure。
- Business code changes: none in Docs update。

## PM Terminal

- Desktop restarted from `C:\Users\123\.codex\worktrees\fae0\tool` with Electron PID `40804`。
- Window activation succeeded by PID and main window title is `TTool`。
- Commit gate remains pending because the user-facing target is still a non-Git partial snapshot and broader worktree contains mixed untracked docs/org state。
