# AGENT_ROLE_REGISTRY

## Registry

| internal_id | 显示名 | role_tag | 状态 | Optional Home Thread id | Home Thread 状态 | 主要职责 | 重点范围 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| t_project_manager | PM - 项目经理 | PM | active | 019f220a-9067-7173-b2e6-743524ff2b22 | created-unpinned | intake、workflow 路由、projection/registry 汇总 | docs/codex、TASK_OVERVIEW、用户沟通 |
| t_product_worker_001 | Sophia - 产品 | Product | active | 019f220a-aab3-7ce1-8997-64f187942522 | optional-existing-index | 需求、范围、验收标准 | docs/PRD.md、docs/TASKS.md |
| t_design_ui_worker_001 | Mia - UI美术 | DesignArt | active | 019f220a-b947-74d1-92c3-9277a9097a7f | optional-existing-index | UI/UX、交互、视觉规范 | src/components、src/styles、设计验收 |
| t_art_asset_worker_001 | Noah - 美术素材 | ArtAsset | optional-active | 019f220a-c827-7133-a125-4e4947ca5ae7 | optional-existing-index | 图片、icon、sprite、texture | imagegen 资产生成与交付 |
| t_eng_general_worker_001 | Alex - 研发 | Engineering | active | 019f220a-dbce-7e83-9a7b-a6d4f21611f6 | optional-existing-index | 实现、重构、API、构建 | src、electron、packages/sdk、scripts |
| t_qa_acceptance_worker_001 | Emma - 测试 | QA | active | 019f220a-e729-71e2-9ad7-5e78dd7d4f7d | optional-existing-index | 验收、回归、证据 | npm scripts、Browser/Computer Use、发布烟测 |
| t_docs_worker_001 | Olivia - 文档 | Docs | active | 019f220a-f1f9-7983-88f5-ee37762cb252 | optional-existing-index | 文档同步、决策记录 | README、CLAUDE、TOOLS、PLUGINS、docs |

## Routing notes

- 插件 SDK、manifest、loader、Electron bridge、`TTOOL-PLUGIN-GUIDE.md` 相关任务默认 Engineering + QA + Docs，必要时 Product。
- UI/UX 任务先到 Mia，涉及新视觉资源时必须经过 Noah / imagegen。
- 文档-only 任务可直接由 Olivia 闭环，必要时 PM 复核。
- Noah 是 optional-active：仅在视觉资产任务出现时派发。
- 员工列表命令：`Use $t-workflow. 查看员工列表。`
- 新建可选 Task Thread 容器标题：`<短任务标题>-<员工英文名>-<职称>`，例如 `新增登录功能-Sophia-产品`。
- Employee Home Thread 缺失或未使用不是异常；员工目录、Task State Projection、registry 和 TASK_OVERVIEW 是路由事实源。
