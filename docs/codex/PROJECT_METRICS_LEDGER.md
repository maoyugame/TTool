# Project Metrics Ledger

| timestamp | row_type | batch_id | task_id | graph_root_id | node_id | execution_driver | worker_id | source | input_tokens | output_tokens | total_tokens | wall_clock_ms | worker_runtime_ms | estimated_cost | currency | confidence | correction_of |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| 2026-07-09T16:58:06+08:00 | task_observability |  | 2026-07-09-ttool-package-after-cursor-release | 2026-07-09-ttool-package-after-cursor-root | 2026-07-09-ttool-package-after-cursor-release | current-worker | Release worker | unavailable | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unavailable |  |
| 2026-07-09T16:32:41+08:00 | task_observability |  | 2026-07-09-screenshot-cursor-contrast | 2026-07-09-screenshot-cursor-contrast-root | 2026-07-09-screenshot-cursor-contrast-eng | current-worker | Engineering worker | unavailable | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unavailable |  |
| 2026-07-09T09:09:46+08:00 | task_observability |  | 2026-07-09-ttool-package-release | 2026-07-09-ttool-package-root | 2026-07-09-ttool-package-release | current-worker | Release worker | unavailable | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unavailable |  |
| 2026-07-08T18:11:52+08:00 | task_observability |  | 2026-07-08-clip-annotation-toolbar-followup | 2026-07-08-clip-annotation-toolbar-followup-root | 2026-07-08-clip-annotation-toolbar-followup-eng | current-worker | Engineering worker | unavailable | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unavailable |  |
| 2026-07-08T17:17:14+08:00 | task_observability |  | 2026-07-08-clip-annotation-reverse-select | 2026-07-08-clip-annotation-reverse-select-root | 2026-07-08-clip-annotation-reverse-select-eng | current-worker | Engineering worker | unavailable | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unavailable |  |
| 2026-07-08T17:41:28+08:00 | task_observability |  | 2026-07-08-clip-inline-annotation-minimize | 2026-07-08-clip-inline-annotation-minimize-root | 2026-07-08-clip-inline-annotation-minimize-eng | current-worker | Engineering worker | unavailable | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unavailable |  |

## Notes

- 尚无可导入的统一 telemetry；不要把人工估算写入 ledger。
- 需要更正历史度量时，追加 `correction` 行并用 `correction_of` 指向被更正行。
