# ACCEPTANCE_PROTOCOL

## Acceptance levels

- Docs-only：检查文件存在、链接路径合理、无业务代码改动。
- Engineering：运行最相关的 typecheck/build/test/smoke，说明覆盖范围。
- UI/UX：补充桌面和移动/窗口尺寸视觉检查，确认文本不重叠、控件可用。
- Plugin contract：除通用检查外，重建并本地安装 `examples/hello-tool` 实测。
- Release：执行发布烟测、构建产物检查和回滚风险记录。

## Evidence template

```md
### Acceptance evidence

- Scope:
- Commands:
- Result:
- UI / Browser evidence:
- Plugin compatibility:
- Known gaps:
- Risk:
```

## QA routing

Bugfix 默认 Alex - 研发 -> Emma - 测试。测试失败时，Emma 写明复现、期望、实际、日志和回流建议，再回流 Alex。
