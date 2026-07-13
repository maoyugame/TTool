# Alex - 研发 CURRENT_CONTEXT

- 当前项目：TTool。
- 当前状态：stage-complete；「TTool 截图贴图普通截图完成自动复制」Engineering 已完成。
- 当前任务：普通 `截图` 成功后默认把截图图片写入系统剪贴板，同时仍显示右下角截图浮窗，用户点击浮窗才进入 AnnotationEditor。
- Pipeline / stage：ordinary capture auto-copy after capture / Engineering stage_complete，等待 Emma QA-lite。
- Task Thread：019f3651-5587-7970-9fba-a80231b9fa1f / 截图完成浮窗与标注增强-Alex-研发。
- Business target：`C:\Users\123\.codex\worktrees\fae0\tool` repaired user-facing non-Git partial snapshot。
- Org record target：`D:\project\tool\docs\codex/**`。
- DesignArt spec：`D:\project\tool\docs\codex\design\screenshot-pin-capture-toast-annotation-enhancement.md`。
- Completion callback：PM thread `019f220a-9067-7173-b2e6-743524ff2b22`；fallback `docs/codex/THREAD_EVENT_INBOX.md`。
- 实现结果：普通 `截图` edit 成功分支在 `rememberScreenshot` 后、`createCaptureToast` 前调用现有内部 `copyImageToClipboard(shot.imageDataUrl)`；复制失败不阻断浮窗/编辑器路径，只记录 warning 并提示 `截图已完成，复制到剪贴板失败`。`截图并贴图` 保持 direct pin；toast 打开/关闭键盘行为、overlay bridge fallback、SDK screenshot 非暴露边界未改。
- 验证结果：main/preload CJS check、auto-copy clipboard smoke、toast/annotation static smoke、toast keyboard smoke、typecheck、smoke、build、overlay bridge smoke、SDK boundary grep 全部通过；Electron clipboard readback 为非空图片 `1224x776`。
- 当前等待：Emma QA-lite。
- 注意事项：`C:\Users\123\.codex\worktrees\fae0\tool` 仍不是 Git repo；commit gate 仍需 PM 后续把 partial target 或 recovery source 归并到可提交 Git worktree。不新增依赖、不生成视觉资产、不修改插件 SDK surface。
