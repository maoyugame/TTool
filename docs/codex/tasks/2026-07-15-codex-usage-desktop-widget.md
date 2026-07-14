---
record_schema_version: 2
record_type: task
task_id: 2026-07-15-codex-usage-desktop-widget
graph_root_id: 2026-07-15-codex-usage-desktop-widget-root
record_version: 7
created_at: 2026-07-15T00:00:00+08:00
updated_at: 2026-07-15T01:28:40+08:00
state_projection_link: docs/codex/tasks/2026-07-15-codex-usage-desktop-widget.md#task-state-projection
---

# TTool Codex 用量状态桌面悬浮工具

## Task State Projection

- status: completed
- progress: 已实现、完整自动化验证并提交产品代码。
- complexity_class: complex
- execution_profile: sol_max
- actual_model_reasoning: current_session / unreported
- outputs: `b3d64bd`（产品代码提交）
- next_action: 可选：在用户桌面打开工具确认本机 Codex CLI 的实时用量显示。
- source_event_id: root-completed
- source_record_version: 7
- projection_version: 3
- updated_at: 2026-07-15T01:28:40+08:00

### Observability

- metrics_mode: off
- required_measurements: []
- capability_checked_at: 2026-07-15T00:00:00+08:00
- capability_decisions: []
- ledger_handling: not_needed
- project_ledger_writer: not_needed
- expected_ledger_head: not_needed
- task_metrics_ref:
    status: not_needed
    task_id: null
    ledger_snapshot_sha256: null
    aggregator_version: null
    refreshed_at: null

## Graph Root

### Root Definition

- graph_root_id: 2026-07-15-codex-usage-desktop-widget-root
- task_id: 2026-07-15-codex-usage-desktop-widget
- task_title: TTool Codex 用量状态桌面悬浮工具
- initial_tier: goal
- initial_tier_trigger: authorized_long_goal
- request_shape: coherent_change_set
- initial_risk: moderate
- initial_complexity_class: complex
- initial_execution_profile: sol_max
- goal: 新增一项内置 Codex 用量工具；启用后显示透明、置顶、鼠标穿透的桌面状态窗，未启用且未手动请求显示时不创建常驻窗。
- done_when: 工具可读取本机 Codex App Server 的已认证用量快照；桌面悬浮窗按需创建、默认置顶且不阻碍鼠标操作；关闭或未启用时释放窗口和子进程；类型检查、构建和冒烟检查通过。
- created_at: 2026-07-15T00:00:00+08:00
- state_projection_link: docs/codex/tasks/2026-07-15-codex-usage-desktop-widget.md#task-state-projection
- previous_graph_root_id: null
- project_area: tools / desktop
- batch_id:
- owner: current_session
- closeout_owner: current_session
- merge_coordinator:
- required_approvals: []
- required_review_qa: typecheck, build, smoke, desktop behavior inspection
- isolation_worktree_handling: current checkout; preserve pre-existing unrelated dirty changes
- constraints: 不读取或暴露 Codex 凭据；只经本机 codex app-server 的公开账户用量方法获取数据；不改动插件 SDK 表面。

### Current Root Snapshot

- tier: goal
- tier_trigger: authorized_long_goal
- risk_level: moderate
- status: completed
- updated_at: 2026-07-15T01:28:40+08:00
- last_root_event_id: root-completed
- execution_driver: native_goal
- concurrency_mode: sequential
- optimization_priority: balanced
- complexity_class: complex
- execution_profile: sol_max
- requested_model: gpt-5.6-sol
- requested_reasoning: max
- actual_model: current_session_unreported
- actual_reasoning: current_session_unreported
- model_fallback: current execution surface cannot select or report the requested profile
- current_effective_nodes: []
- unresolved_blockers: []
- unresolved_decisions: []
- completion_gates:
  - gate: qa_review
    status: satisfied
    evidence: `npm run check` exit 0；Codex 用量服务单测 exit 0；主进程静态语法检查 exit 0
  - gate: observability
    status: not_applicable
    evidence: metrics_mode off
  - gate: commit
    status: satisfied
    evidence: product commit `b3d64bd`，仅包含本任务代码与工具文档
  - gate: approval
    status: not_applicable
    evidence: no production, destructive, access, or dependency change
  - gate: callback
    status: not_applicable
    evidence:
- done_when_evidence: 按需 App Server 服务、透明鼠标穿透置顶窗口、禁用释放、类型/构建/冒烟/回归检查均已实现并验证。

## Authorization And Capability Preflight

- checked_at: 2026-07-15T00:00:00+08:00
- checked_by: current_session
- consolidated_decision_required: false
- independent_work_may_proceed: true
- recheck_condition: 真实 Electron 启动时确认本机 Codex CLI 是否可执行；不可用时展示可恢复的未安装状态。

| Action / Root Or Node | Required Authority Or Capability | Status | Evidence / Fallback |
| --- | --- | --- | --- |
| Shared workflow record | Project-local shared records | authorized | `AGENTS.md` / `PROJECT_CONTEXT.md` configure `docs/codex/` |
| Native Goal | Explicit `$t-workflow` + exposed Goal capability | available | `create_goal` available |
| Codex usage source | Public local App Server account methods | available | Installed `codex-cli 0.142.3` schema exposes `account/rateLimits/read` and `account/usage/read` |
| Desktop overlay | Existing Electron main/preload bridge | available | No new dependency; use a transparent click-through `BrowserWindow` |
| Production dependency | Explicit approval | not_needed | No dependency added |
| Local task commits | Scoped Git staging amid dirty checkout | authorized | Stage only this task's hunks/files; no push |

## Direct Execution Snapshot

- direct_execution_status: succeeded
- graph_node_action: not_needed
- started_at: 2026-07-15T01:17:03+08:00
- finished_at: 2026-07-15T01:28:40+08:00
- outputs: `b3d64bd`
- validation: `npm run check`; `node scripts/codex-usage-test.cjs`; `node --check electron/main.cjs`
- last_root_event_id: root-completed
- updated_at: 2026-07-15T01:28:40+08:00
- node_container_handling: not_needed
- node_container_archive_status: not_applicable

## Native Goal Driver Snapshot

- goal_start_authorized: yes
- native_goal_id: 019f619b-ed73-70f3-8f22-9cb17cc78cb1
- native_goal_status: completed
- native_goal_last_observed_at: 2026-07-15T01:28:40+08:00
- native_goal_result: completed
- goal_contract_link:

> This is a driver snapshot only. It must not override Current Root Snapshot.

## Root Events

### Root Event root-created

- event_id: root-created
- event_sequence: 1
- graph_root_id: 2026-07-15-codex-usage-desktop-widget-root
- event_type: root_created
- occurred_at: 2026-07-15T00:00:00+08:00
- actor: current_session
- from_status:
- to_status: planned
- summary: 创建可恢复的 Goal 任务记录；选择顺序执行和直接执行路径。
- evidence_links: AGENTS.md, docs/codex/PROJECT_CONTEXT.md, Codex App Server generated schema

### Root Event model-capability-observed

- event_id: model-capability-observed
- event_sequence: 2
- graph_root_id: 2026-07-15-codex-usage-desktop-widget-root
- event_type: model_capability_observed
- occurred_at: 2026-07-15T01:17:03+08:00
- actor: current_session
- from_status: planned
- to_status: planned
- summary: 记录目标 `sol_max` 配置在当前执行面不可显式选择或回读；继续使用当前会话作为回退。
- evidence_links: current session capability surface
- requested_model: gpt-5.6-sol
- requested_reasoning: max
- actual_model: current_session_unreported
- actual_reasoning: current_session_unreported
- model_fallback: current execution surface cannot select or report the requested profile

### Root Event direct-execution-started

- event_id: direct-execution-started
- event_sequence: 3
- graph_root_id: 2026-07-15-codex-usage-desktop-widget-root
- event_type: direct_execution_started
- occurred_at: 2026-07-15T01:17:03+08:00
- actor: current_session
- from_status: planned
- to_status: active
- summary: 已启动原生 Goal，并开始当前会话的直接实施路径。
- evidence_links: native_goal:019f619b-ed73-70f3-8f22-9cb17cc78cb1
- metadata: direct_execution_status=active

### Root Event direct-execution-succeeded

- event_id: direct-execution-succeeded
- event_sequence: 4
- graph_root_id: 2026-07-15-codex-usage-desktop-widget-root
- event_type: direct_execution_succeeded
- occurred_at: 2026-07-15T01:28:40+08:00
- actor: current_session
- from_status: active
- to_status: active
- summary: 按需 Codex 用量服务、透明置顶鼠标穿透悬浮窗、first-party bridge 和内置工具页均已完成。
- evidence_links: electron/codex-usage.cjs, electron/main.cjs, src/tools/impl/codexUsage.tsx
- metadata: direct_execution_status=succeeded

### Root Event qa-review-satisfied

- event_id: qa-review-satisfied
- event_sequence: 5
- graph_root_id: 2026-07-15-codex-usage-desktop-widget-root
- event_type: completion_gate_updated
- occurred_at: 2026-07-15T01:28:40+08:00
- actor: current_session
- from_status: active
- to_status: active
- summary: 自动化 QA、插件链路和截图回归均通过。
- evidence_links: npm run check (exit 0); node scripts/codex-usage-test.cjs (exit 0); node --check electron/main.cjs (exit 0)
- gate: qa_review
- gate_status: satisfied
- gate_evidence: `npm run check` 完整通过；桌面交互环境未提供可带项目参数启动的 TTool 进程，保留用户桌面实测为非阻塞剩余风险。

### Root Event commit-satisfied

- event_id: commit-satisfied
- event_sequence: 6
- graph_root_id: 2026-07-15-codex-usage-desktop-widget-root
- event_type: completion_gate_updated
- occurred_at: 2026-07-15T01:28:40+08:00
- actor: current_session
- from_status: active
- to_status: active
- summary: 产品代码已使用精确暂存 hunks 提交，未包含已有截图和文件搜索改动。
- evidence_links: git commit b3d64bd
- gate: commit
- gate_status: satisfied
- gate_evidence: b3d64bd feat: add on-demand Codex usage widget

### Root Event root-completed

- event_id: root-completed
- event_sequence: 7
- graph_root_id: 2026-07-15-codex-usage-desktop-widget-root
- event_type: root_completed
- occurred_at: 2026-07-15T01:28:40+08:00
- actor: current_session
- from_status: active
- to_status: completed
- summary: 所有请求范围、验证和产品提交门禁已完成；共享记录等待单独元数据提交。
- evidence_links: b3d64bd; docs/codex/tasks/2026-07-15-codex-usage-desktop-widget.md

## Changes

- 新增 `codex-usage` 内置工具与响应式用量页面。
- 新增主进程 App Server JSONL 客户端、按需生命周期和透明鼠标穿透置顶窗口。
- first-party preload/platform bridge 仅供内置工具使用；`TToolSDK.platform` 未扩展。
- 更新内置工具文档和用量服务测试。

## Validation

- `npm run check`：通过（类型、文件搜索、截图、更新器、插件、发布配置、SSR、构建）。
- `node scripts/codex-usage-test.cjs`：通过（懒启动、初始化握手、快照和停止生命周期）。
- `node --check electron/main.cjs`：通过。

## Risks

- 账户限额字段由本机 Codex CLI 版本决定；工具必须容忍缺失的限额桶并呈现可理解的不可用状态。
- 自动化桌面环境无法以项目参数启动 TTool 进行实时视觉交互；窗口配置和生命周期由代码审查与自动化检查覆盖，首次用户桌面使用可确认实际显示效果。
- 工作区原有 Electron、平台、截图和文件搜索改动仍保持未提交且未纳入产品提交。

## Follow-up

- 关闭或禁用后不保留用量 App Server 子进程或悬浮窗口。
