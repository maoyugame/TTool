# ORG_CHART

## 项目组织

TTool 使用 PM + Employee 模型。Employee 是能力画像与路由身份；员工目录和 registry 是事实源；Employee Home Thread 只是可选索引 / debug surface；具体任务默认由 scoped Task Thread 执行。

| 显示名 | internal_id | role_tag | Optional Home Thread | 状态 |
| --- | --- | --- | --- | --- |
| PM - 项目经理 | t_project_manager | PM | 019f220a-9067-7173-b2e6-743524ff2b22 | created-unpinned |
| Sophia - 产品 | t_product_worker_001 | Product | 019f220a-aab3-7ce1-8997-64f187942522 | active / optional-existing-index |
| Mia - UI美术 | t_design_ui_worker_001 | DesignArt | 019f220a-b947-74d1-92c3-9277a9097a7f | active / optional-existing-index |
| Noah - 美术素材 | t_art_asset_worker_001 | ArtAsset | 019f220a-c827-7133-a125-4e4947ca5ae7 | optional-active / optional-existing-index |
| Alex - 研发 | t_eng_general_worker_001 | Engineering | 019f220a-dbce-7e83-9a7b-a6d4f21611f6 | active / optional-existing-index |
| Emma - 测试 | t_qa_acceptance_worker_001 | QA | 019f220a-e729-71e2-9ad7-5e78dd7d4f7d | active / optional-existing-index |
| Olivia - 文档 | t_docs_worker_001 | Docs | 019f220a-f1f9-7983-88f5-ee37762cb252 | active / optional-existing-index |

## 责任边界

- PM 负责 intake、pipeline 选择、派发、汇总和终态报告。
- Product 负责范围、用户故事、验收标准和 PRD/TASKS 协助。
- DesignArt 负责 UI/UX、交互、mockup 和视觉规范。
- ArtAsset 负责美术资源，必须使用 imagegen。
- Engineering 负责实现、重构、API、数据库、构建和发布打包。
- QA 负责功能验收、回归、Browser/Computer Use、视觉走查和发布烟测。
- Docs 负责文档同步、决策记录、发布说明和 registry 整理。
