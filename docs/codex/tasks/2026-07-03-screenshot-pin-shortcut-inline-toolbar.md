# TTool 截图贴图快捷键外置与状态操作栏整理
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
- status: terminal; desktop restart in progress; commit gate pending
- owner: PM - 项目经理
- pipeline: TTool 截图贴图 v1 / shortcut settings inline toolbar polish after user acceptance
- context_mode: lite
- plan_first: short-plan
- goal_mode: no
- goal: 移除截图贴图工具页右侧 `设置` 按钮，将快捷键设置外置到顶部栏中间区域，并整理状态与操作栏信息。
- done_when: DesignArt 规格、Engineering 实现、QA 验收完成，桌面端重启供用户验收。
- task_thread: 019f2782-5221-7fd1-9f15-0254ad278758 / 截图贴图快捷键外置与状态栏整理-Emma-测试
- previous_thread_id: 019f220a-9067-7173-b2e6-743524ff2b22
- archive_status: DesignArt/Engineering archived; QA pass evidence recorded; PM direct docs sync
- archived_at: n/a
- archive_reason: n/a
- restore_policy: archive stage Task Threads after completion callback and PM record update

## Pipeline / Route Summary

- Pipeline Decision: UI polish after user acceptance; fast-lane-lite with DesignArt -> Engineering -> QA -> PM。
- Current stage: PM terminal / desktop restart。
- Imagegen-only art gate: not-needed；本任务只调整布局/交互规格，不生成视觉资产。
- User input required: no。

## Stage Threads

- DesignArt: Mia - UI美术 / 019f2773-6466-75e0-8334-66100a20a16e / stage-complete / archived。
- Engineering: Alex - 研发 / 019f2777-e9d7-7983-9d7f-4e039a94b5f6 / stage-complete / archived。
- QA: Emma - 测试 / 019f2782-5221-7fd1-9f15-0254ad278758 / pass evidence recorded；thread record update stalled, PM took over docs/registry closure。

## Requirements

- 移除右侧 `设置` 按钮。
- 将两条快捷键配置放到顶部状态与操作栏中间空白区域。
- 状态与操作栏左侧做信息去重，右侧保留启用和主操作。
- 保留所有既有截图贴图功能和 SDK 非暴露边界。

## Deliverable

- DesignArt spec: `docs/codex/design/screenshot-pin-shortcut-inline-toolbar.md`。
- Engineering target: `C:\Users\123\.codex\worktrees\fae0\tool\src\tools\impl\screenshotPin.tsx`。
- Engineering implementation: removed the right-side `设置` button and shortcut settings panel entry; added inline shortcut controls in the top middle status bar; simplified left status chips by moving shortcut registration state into inline rows; preserved right-side enable switch and `截图` / `截图并贴图` primary actions.
- Validation helper: `C:\Users\123\.codex\worktrees\fae0\tool\.verify\screenshot-pin-shortcut-inline-smoke.cjs`。

## Validation

- PASS read project routing rules, current registry, current screenshot-pin implementation entry, and user reference image。
- PASS docs-only constraints: no business-code edits, no visual assets generated。
- PASS `node --check electron/main.cjs`。
- PASS `node --check electron/preload.cjs`。
- PASS `npm run typecheck`。
- PASS `npm run build` after adding `D:\project\tool\node_modules\.bin` to PATH for the partial target。
- PASS `npm run smoke` after adding `D:\project\tool\node_modules\.bin` to PATH。
- PASS SDK exposure grep: no plugin-visible `platform.screenshot`, `screenshot?: ScreenshotApi`, `screenshot: bridge.screenshot`, or `TToolSDK.platform.screenshot` matches。
- PASS inline toolbar source check: no `settingsOpen`, `onToggleSettings`, `ShortcutPanel`, `screenshot-pin-settings`, `收起设置`, right-side `设置`, duplicate `截图：` / `贴图：` chips, or `Press shortcut` remnants。
- PASS `.verify/screenshot-pin-shortcut-inline-smoke.cjs`: no `设置` button, 2 inline shortcut rows, no duplicate shortcut chips in left status, main actions visible, 1440/1366/980/707 widths without overflow, record state and Esc cancel verified。
- PASS `.verify/overlay-bridge-smoke.cjs`: no TypeError; `✓`, double-click, `贴图`, `复制`, cancel, Esc, invalid small selection, and no overlay `标注` verified。

## Risks

- 顶部栏可能因为内联快捷键变高；Engineering 需要通过 1366、约 980、窄宽度断点避免挤压编辑器。
- 快捷键录制/冲突/注册失败逻辑必须复用现有数据流，不能重新实现出分叉行为。
- `C:\Users\123\.codex\worktrees\fae0\tool` 仍是 non-Git partial snapshot；commit gate 仍需 PM 后续把 feature state reconcile 到 coherent Git-backed worktree。

## Follow-up

- QA accepted based on recorded evidence: no `设置` button, 2 inline shortcut rows, status de-duplication, main actions visible, 1440/1366/980/707 responsive checks, shortcut record/Esc cancel, overlay bridge regression, and SDK boundary passed。
- PM completed docs-only sync for user-visible behavior: shortcut settings are now in the top middle status/action bar, and the screenshot-pin page no longer has a dedicated `设置` button。
- Next: restart desktop app from `C:\Users\123\.codex\worktrees\fae0\tool` for user acceptance。
