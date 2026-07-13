# MERGE_PROTOCOL

## Scope

本协议用于 Task Thread、Worker Thread、worktree 或 Local direct 产出的变更合并前检查。

## Merge checklist

- Scope 与用户请求一致，没有夹带无关改动。
- `git status --short` 已检查。
- 相关测试、typecheck、build 或 smoke 已运行，或无法运行原因已记录。
- 未提交 secret、env、本地缓存、构建产物、coverage 或依赖目录。
- 插件契约改动已同步 `TTOOL-PLUGIN-GUIDE.md`、`PLUGINS.md`、`packages/sdk/src/index.ts` 等相关文档。
- UI/视觉资源遵守 imagegen-only art gate。
- 文档、registry、员工记忆已按需同步。

## Commit gate

代码改动闭环只有在项目策略允许、请求范围完成、相关检查通过或失败已记录、diff 无无关用户改动、没有 secret/env/build artifact、commit message 清晰时才自动提交。否则报告未提交原因与当前 git 状态。
