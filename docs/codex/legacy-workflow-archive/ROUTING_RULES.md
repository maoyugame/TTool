# ROUTING_RULES

本文件只记录 TTool 项目特有路由覆盖项。通用流程、Task Graph、Task State Projection、可选容器、Local direct、inbox、worktree、归档和 imagegen 门禁遵循全局 `$t-workflow`。

## Project routing

- 默认使用 `context_mode: lite`；小任务只读 registry 当前任务、候选员工 `CURRENT_CONTEXT.md` / `CAPABILITY_SUMMARY.md` 和本文件。
- 默认执行 Plan / Goal Gate：所有路由任务都写 `Goal` 和 `Done when`；小任务只写 micro-plan，不默认启用 Goal mode。
- 插件契约、发布、跨模块 UI/桌面能力或高风险修复必须 Plan-first；多阶段长任务推荐 Goal mode。
- 插件契约改动默认 Full Pipeline。
- 插件契约、manifest、loader、Electron bridge、SDK surface、`TTOOL-PLUGIN-GUIDE.md` 相关改动需评估兼容性和文档同步风险。
- Bugfix 默认优先由 Alex - 研发处理，并由 Emma - 测试复验。
- 文档-only 任务默认 Olivia - 文档；纯组织文档维护可按全局 workflow docs-only 规则处理。
- UI/视觉优化、mockup、图片、icon、sprite、纹理和视觉资源默认先评估 Mia / Noah 是否参与。
- 无匹配项目模板时，可在 `docs/codex/PIPELINE_TEMPLATES.md` 记录 TTool 特有模板；通用模板应更新全局模板库。

## Project graph / container naming

- 默认把任务建模为 Task Graph / Graph Node；Task Thread 只是可选容器，不是任务状态源。
- 需要新建可选容器时，标题使用 `<短任务标题>-<员工英文名>-<职称>`，例如 `新增登录功能-Sophia-产品`。
- Graph Node 派发必须使用 clean Dispatch Packet；不得从 PM 当前对话派生或继承 PM 完整 transcript。
- 员工目录、Task State Projection、registry 和 `TASK_OVERVIEW.md` 是默认路由事实源；Employee Home Thread 是可选索引 / debug surface，不默认创建或参与派发。
- 查看员工列表使用：`Use $t-workflow. 查看员工列表。`
- 查看近期任务和能力摘要使用：`Use $t-workflow. 选择员工查看近期任务和能力摘要。`
- 如当前 Codex surface 支持结构化选择 UI，优先弹出选择；否则降级为编号列表。

## PM context budget

- PM thread 只做短期协调；长期状态写入 task record 的 Task State Projection、`TASK_OVERVIEW.md`、registry、`TASK_EVENT_INBOX.md` 和员工记忆。
- Stage Completion Packet 默认保持短摘要；不要把完整日志、完整 diff 或长测试输出回传给 PM。
- 复杂、模糊、多阶段、高风险或 PM 上下文压力高时，可用 subagent 做路由分析；小任务不默认启用 subagent。
- 可选容器完成后默认归档；归档状态写入 task record。活跃任务或等待用户直接交互的容器不自动归档。
