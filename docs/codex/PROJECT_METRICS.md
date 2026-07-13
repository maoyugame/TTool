# Project Metrics

本文件是项目级派生聚合，只汇总可度量数据；任务真实状态以 `docs/codex/tasks/*.md` 的 Task State Projection 为准。

- total_input_tokens: unknown
- total_output_tokens: unknown
- total_tokens: unknown
- total_estimated_cost: unknown
- currency: unknown
- total_task_wall_clock_ms: unknown
- total_worker_runtime_ms: unknown
- total_tasks: 20
- measured_tasks: 0
- measured_parallel_tasks: 0
- unknown_metric_tasks: 20
- parallel_speedup_estimate: unknown
- last_recalculated_at: 2026-07-09
- last_updated: 2026-07-09

## Notes

- 本次迁移没有可用的统一 token/cost/runtime API telemetry，因此历史任务 observability 均标记为 `unknown` / `unavailable`。
- 后续若有可度量任务，应先追加 `PROJECT_METRICS_LEDGER.md`，再刷新本聚合文件。
- 2026-07-08 legacy workflow cleanup 没有可用统一 telemetry，未向 ledger 写入人工估算。
- 2026-07-08 clip inline annotation worker 没有可用统一 telemetry，ledger 仅记录 unknown/unavailable。
- 2026-07-08 clip annotation toolbar follow-up worker 没有可用统一 telemetry，ledger 仅记录 unknown/unavailable。
- 2026-07-09 TTool Windows packaging worker 没有可用统一 telemetry，ledger 仅记录 unknown/unavailable。
- 2026-07-09 screenshot cursor contrast worker 没有可用统一 telemetry，ledger 仅记录 unknown/unavailable。
- 2026-07-09 TTool after-cursor Windows packaging worker 没有可用统一 telemetry，ledger 仅记录 unknown/unavailable。
