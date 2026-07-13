# PIPELINE_TEMPLATES

本文件只记录 TTool 项目特有模板。通用模板引用全局 `$t-workflow`。

## TTool plugin contract change

- Trigger: SDK、manifest、plugin loader、Electron plugin manager、preload bridge、external/globals、`TTOOL-PLUGIN-GUIDE.md`。
- Pipeline: `full-pipeline`
- Stages: Product scope if behavior changes -> Engineering -> QA -> Docs -> PM summary。
- Required checks: `npm run typecheck`、`npm run build`、`npm run smoke`，插件链路改动还需重建并本地安装 `examples/hello-tool`。
- Docs: `TTOOL-PLUGIN-GUIDE.md`、`PLUGINS.md`、`packages/sdk/src/index.ts`、必要时 `docs/API_SPEC.md`。

## UI / visual change

- Trigger: 启动台、标签工作区、主题、工具页 UI、视觉规范、mockup、图标或图片。
- Pipeline: `full-pipeline` when visual assets or broad UI behavior are involved; otherwise `fast-lane` DesignArt -> Engineering -> QA。
- Art gate: 所有视觉资源必须使用 `$imagegen` / built-in `image_gen`。
- Required checks: responsive visual review, no text overlap, relevant npm checks。

## Bugfix

- Trigger: 明确 bug、回归、报错、测试失败。
- Pipeline: usually `fast-lane`
- Stages: Engineering -> QA -> PM summary。
- Required evidence: reproduction or code-level cause, focused fix, relevant command output, residual risk。
