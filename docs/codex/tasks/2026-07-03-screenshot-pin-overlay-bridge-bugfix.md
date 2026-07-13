# TTool 截图贴图 overlay bridge undefined 严重修复
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
- pipeline: TTool 截图贴图 v1 / overlay bridge runtime bugfix after user acceptance
- context_mode: lite
- task_thread: multiple stage threads
- previous_thread_id: 019f2715-1caa-70b0-8bc4-a3555b4e9650; 019f2707-702c-7131-9f1e-86e8bad0fc96
- archive_status: completed-stage-threads-archived
- archived_at: 2026-07-03 17:17 +08:00
- archive_reason: Engineering and QA stages completed, callback delivered, PM records updated
- restore_policy: create a new targeted Task Thread for further overlay regressions; read this task record first

## Pipeline / Route Summary

Pipeline Decision:

- Request summary: 用户反馈触发截图后 overlay 底部按钮全部无法点击，控制台报 `Cannot read properties of undefined (reading 'screenshot')`。
- Task classification: engineering / bugfix / Electron overlay bridge。
- Execution path: fast-lane-lite bugfix。
- Pipeline template: Bugfix = Engineering -> QA -> PM。
- Current stage: QA stage-complete。
- Imagegen-only art gate: not-needed。
- User input required: no。

Route Decision:

- Target role_tag: Engineering。
- Target employee: Alex - 研发。
- Execution surface: Task Thread。
- Target Task Thread title/id: 截图贴图overlay桥接修复-Alex-研发 / 019f2723-8f15-77e0-a92e-f7bc0167b59f。
- Isolation: existing Codex App managed feature worktree inherited from source thread。
- Actual worktree path: `C:\Users\123\.codex\worktrees\fae0\tool`。
- Branch: `codex/019f224d59e37923b0becfe44610602a`。
- Dirty checkout risk: high; feature worktree contains prior screenshot-pin business/docs/org changes, so fix must stay scoped。
- Acceptance strategy: targeted overlay real-click/button route verification, standard build checks, SDK boundary regression。
- Completion callback: PM thread `019f220a-9067-7173-b2e6-743524ff2b22`。
- Inbox fallback: `docs/codex/THREAD_EVENT_INBOX.md`。

## Stage Threads

- Engineering: Alex - 研发 / `019f2723-8f15-77e0-a92e-f7bc0167b59f` / stage-complete after retry; archived after QA dispatch。
- QA: Emma - 测试 / `019f273e-9139-7da0-afe8-9cff4d4e4b38` / stage-complete; archived after PM record update。

## Prior Engineering Attempt / Blocker

- Engineering attempt result: blocked before business-code modification。
- Effective cwd from Codex task thread: `C:\Users\123\.codex\worktrees\fae0\tool`。
- Blocker detail: the dispatched cwd is not a Git repository, has no `.git`, and is missing `electron/` and `docs/` even though the bug is in `electron/main.cjs` overlay HTML/IPC. It only contains a partial source snapshot such as `src/tools/impl/screenshotPin.tsx`。
- Cross-check: `D:\project\tool` is a Git repository, but it is on `main @ e9d1a53`; its `codex/019f224d59e37923b0becfe44610602a` ref points to the same commit and does not contain the current `screenshot-pin` implementation (`src/tools/impl/screenshotPin.tsx`) or `src/platform/screenshot.ts`。
- Safety decision: no business-code edits were made because patching either the partial non-Git snapshot or the main checkout would not reliably fix the user-facing feature worktree and could create misleading, unmergeable changes。
- Inferred code root cause remains: overlay inline `data:` page calls `window.ttool.screenshot.overlaySelect/overlayCancel`, but the actual overlay window lacks that bridge. The likely repair is to route overlay actions/cancel through a guaranteed overlay-local IPC/preload path or a main-process-injected internal bridge, plus defensive failure handling; this must be applied in the complete feature checkout containing the real `electron/main.cjs` overlay implementation。

## Engineering Retry / Recovery / Fix

- Recovery dry-run target: `D:\project\tool\.verify\recovery-overlay-bridge`。
- Recovery method: exported clean `D:\project\tool` HEAD into `.verify`, then replayed successful archived `apply_patch` payloads from the six PM-provided Engineering sessions in chronological order with a custom unified-diff replay script. Initial `git apply` dry-run was rejected as unsafe because Git resolved upward to `D:\project\tool` instead of the temp target。
- Recovered feature state contained the required files: `electron/main.cjs`, `electron/preload.cjs`, `src/tools/impl/screenshotPin.tsx`, `src/platform/screenshot.ts`, `src/platform/types.ts`, `src/vite-env.d.ts`, `src/sdk/index.ts`, and package scripts。
- Actual repaired target: `C:\Users\123\.codex\worktrees\fae0\tool` partial snapshot. It is still not Git-backed; `electron/` was restored from the fixed recovery target and missing `index.html` was restored so build/smoke can run against the user-facing target。
- Root cause: the screenshot overlay is loaded from inline `data:` HTML. In the user runtime that overlay did not have `window.ttool.screenshot`, but the button/cancel/double-click code hard-called `window.ttool.screenshot.overlaySelect/overlayCancel`, causing `Cannot read properties of undefined (reading 'screenshot')` and leaving the overlay feeling frozen。
- Fix: overlay `submit`/cancel/Esc now routes through a defensive `sendOverlay` helper. It uses `window.ttool.screenshot` when present, otherwise falls back to `ttool-overlay://select|cancel?payload=...`. Main process now intercepts overlay `will-navigate` / `will-redirect` / `setWindowOpenHandler` for that internal URL, parses the payload, and calls the existing `completeOverlaySelection` / `cancelOverlaySelection` path. Bridge failures update the overlay status instead of throwing synchronously。
- Preserved behavior: overlay toolbar still has no `标注` / `data-action="edit"`; order remains `复制` / `保存` / `贴图` / separator / `取消` / `✓`; normal screenshot default confirm/double-click routes to AnnotationEditor; screenshot+pin default confirm/double-click creates pin; SDK-visible `TToolSDK.platform` still does not expose screenshot。

## PM Recovery Follow-up

- PM found recovery material in Codex archived session logs under `C:\Users\123\.codex\archived_sessions\`。
- These logs include `apply_patch` records for the prior feature worktree, including `electron/main.cjs` screenshot IPC/overlay code and later overlay/layout reworks。
- PM re-dispatched Alex on the same Task Thread with instructions to:
  - use archived session patch logs as recovery source;
  - dry-run or otherwise prove recovery before touching `D:\project\tool` main;
  - rebuild or recover a coherent feature checkout containing both Electron and renderer feature files;
  - apply the overlay bridge bugfix only after recovery;
  - record the actual recovery target path and commit-gate limitations。
- Key archived sessions supplied to Alex:
  - `rollout-2026-07-02T18-11-27-019f224f-bbab-73b1-8ba1-06433194f771.jsonl`
  - `rollout-2026-07-03T11-16-54-019f25fa-9f14-7d00-9ea7-e435a587dbc6.jsonl`
  - `rollout-2026-07-03T11-58-46-019f2620-f2ca-7002-a74e-5bbaeeaeb059.jsonl`
  - `rollout-2026-07-03T14-31-10-019f26ac-7ae2-77f1-8f47-97abd9c6a4d7.jsonl`
  - `rollout-2026-07-03T14-58-24-019f26c5-6967-7da3-9cec-24d62c3a8d46.jsonl`
  - `rollout-2026-07-03T16-10-31-019f2707-702c-7131-9f1e-86e8bad0fc96.jsonl`

## Bug Evidence

- User attachment: `C:\Users\123\.codex\attachments\e318fed1-b98d-4964-b54a-c27ec5e90fbc\pasted-text.txt`。
- Key error: `Uncaught TypeError: Cannot read properties of undefined (reading 'screenshot')`。
- Stack points to overlay `data:text/html` page:
  - `submit(action)` calls `window.ttool.screenshot.overlaySelect(...)`。
  - Esc/cancel calls `window.ttool.screenshot.overlayCancel(...)`。
- PM inference: screenshot overlay window does not have `window.ttool.screenshot` bridge available, so toolbar actions throw and appear frozen。

## Required Engineering Scope

- Fix overlay action/cancel path for toolbar buttons, `✓`, double-click confirm, and Esc cancel。
- Make overlay bridge/IPC robust for `data:` page overlay windows, or remove dependency on missing `window.ttool.screenshot` in that context。
- Add defensive guard/fallback so missing bridge does not throw and leave overlay stuck。
- Preserve toolbar without `标注`, order `复制` / `保存` / `贴图` / separator / `取消` / `✓`。
- Preserve default routes: normal screenshot enters AnnotationEditor; screenshot+pin creates pin。
- Preserve SDK boundary: no plugin-visible screenshot API。
- No new dependencies, no visual assets, no commits。

## Validation

Engineering retry validation passed.

Recovery target `D:\project\tool\.verify\recovery-overlay-bridge`:

- PASS `node --check electron/main.cjs`
- PASS `node --check electron/preload.cjs`
- PASS `npm run typecheck`
- PASS `npm run build`
- PASS `npm run smoke` (`REGISTERED 4 : translate,screenshot-pin,json,timestamp`; `SSR OK: 5 render targets passed`)
- PASS SDK exposure grep/source check: no plugin-visible `platform.screenshot`, `screenshot: bridge.screenshot`, `screenshot?: ScreenshotApi`, or `TToolSDK.platform.screenshot`
- PASS overlay smoke with no preload/no `window.ttool`: `✓` edit, `✓` auto-pin, toolbar `贴图`, toolbar `复制`, cancel button, Esc, double-click edit, invalid `3x3` selection, no `TypeError`, and no overlay `标注`
- PASS `electron scripts/capture.cjs` capture spot-check

Actual partial target `C:\Users\123\.codex\worktrees\fae0\tool`:

- PASS `node --check electron/main.cjs`
- PASS `node --check electron/preload.cjs`
- PASS `npm run typecheck`
- PASS `npm run build`
- PASS `npm run smoke` (`REGISTERED 4 : translate,screenshot-pin,json,timestamp`; `SSR OK: 5 render targets passed`)
- PASS SDK exposure grep/source check
- PASS overlay smoke with fallback bridge and no `window.ttool` dependency
- PASS explicit `electron scripts/capture.cjs` capture spot-check after a timed-out `npx electron` attempt; the timed-out validation processes were cleaned up
- PASS targeted trailing-whitespace scan on repaired target

## QA Acceptance

- Acceptance decision: pass / stage-complete。
- Actual target validated: `C:\Users\123\.codex\worktrees\fae0\tool`。This target remains a non-Git partial snapshot; QA did not use `D:\project\tool` main for business validation。
- Dependency note: commands used `D:\project\tool\node_modules\.bin` prepended to PATH where needed, because the repaired target is a partial snapshot。
- PASS `node --check electron/main.cjs`
- PASS `node --check electron/preload.cjs`
- PASS `npm run typecheck`
- PASS `npm run build`
- PASS `npm run smoke` (`REGISTERED 4 : translate,screenshot-pin,json,timestamp`; `SSR OK: 5 render targets passed`)
- PASS SDK exposure grep/source check: no plugin-visible `platform.screenshot`, `screenshot: bridge.screenshot`, `screenshot?: ScreenshotApi`, or `TToolSDK.platform.screenshot`
- PASS overlay static/source review: overlay exposes `data-action="copy"`, `data-action="save"`, `data-action="pin"`, and `data-action="default"` only; no overlay `data-action="edit"`。A separate pin-window toolbar still has `标注`, which is expected and not the screenshot overlay。
- PASS overlay bridge smoke with no preload/no `window.ttool`: valid `✓` normal action emitted `edit`; valid double-click emitted `edit`; screenshot+pin `✓` emitted `pin`; toolbar `贴图` emitted `pin`; toolbar `复制` emitted `copy`; `取消` and Esc emitted cancel; invalid `3x3` selection showed `选区过小`, disabled actions, and no bad select event; no `Cannot read properties of undefined (reading 'screenshot')` or TypeError。
- PASS source route review: fallback `ttool-overlay://select|cancel` is intercepted by main and routes to existing `completeOverlaySelection` / `cancelOverlaySelection`; `pin` creates pin, `copy` copies, `save` saves, and default non-pin route delivers capture to AnnotationEditor。
- PASS explicit Electron capture spot-check: `electron scripts/capture.cjs` produced `.verify\cap-home.jpg`。
- PASS imagegen gate: no new icon/mockup/raster visual assets found beyond existing tool icons and `.verify` validation capture artifact。

## Risks

- QA accepted the targeted overlay bridge fix with Electron/DOM/source evidence. A final user desktop restart/acceptance pass is still expected by PM。
- The repaired target remains a partial, non-Git snapshot; commit gate is blocked until PM recreates or stages this feature state into a coherent Git-backed worktree。
- Pin window code still uses the first-party preload `window.ttool.screenshot` bridge; that is outside the reported overlay `data:` page failure and was not changed。

## Follow-up

- PM terminal: restarted desktop app from repaired target `C:\Users\123\.codex\worktrees\fae0\tool` using `D:\project\tool\node_modules\electron\dist\electron.exe .`; main PID observed as `22760`, renderer app path confirmed as the repaired target.
- User acceptance: verify screenshot overlay buttons no longer freeze and no `window.ttool.screenshot` TypeError appears.
- Commit gate remains pending until user accepts and PM reconciles the repaired partial target into a coherent Git-backed worktree.
