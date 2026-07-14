# TTool 桌面运行时与技术栈评估

评估日期：2026-07-14。目标是为 Windows 自动更新与内部发布选择风险最低、长期可维护的技术路线。

## 结论

继续使用 Electron，并将 Electron、electron-builder 与 Vite 升级到受支持且无已知 npm audit 漏洞的版本。当前不迁移 Tauri/Rust。

本次基线发现：

- Electron 30 已超出 Electron“只支持最新三个稳定大版本”的维护范围；升级到 43.x。
- electron-builder 24 与 Vite 5 的旧开发链在 npm audit 中合计出现 7 个 high、1 个 moderate；升级后完整 audit 为 0。
- React 已在独立兼容步骤中升级到 19.2.7。SDK peer 保持 `^18 || ^19`，external/globals 名称和 SDK v1 表面均未改变；旧插件仍复用宿主单例，示例插件按 React 19/Vite 8 重新构建验收。
- MongoDB/BSON 等业务依赖保持当前主版本，避免把无关破坏性迁移并入发布链改造。

Electron 官方支持策略：<https://www.electronjs.org/docs/latest/tutorial/electron-timelines>。Electron 43 运行 Chromium 150、Node 24：<https://releases.electronjs.org/release/v43.0.0>。

## Electron 与 Tauri/Rust 对比

| 维度 | Electron（当前选择） | Tauri/Rust |
| --- | --- | --- |
| 现有代码复用 | 主进程、preload、插件、DB、网络、截图全部复用 | React UI 可复用，宿主能力需重写 |
| 安装体积/内存 | 较大，内置 Chromium | 较小，使用系统 WebView2 |
| Web 一致性 | Chromium 版本由应用控制 | 随系统 WebView2 版本变化 |
| 插件兼容 | 已有 IIFE + React/TToolSDK 全局契约 | 必须重建插件执行与隔离模型 |
| 自动更新 | NSIS、blockmap、GitHub Provider 已成熟 | updater 强制独立签名，发布模型也成熟 |
| 当前实施风险 | 中等：升级并回归 | 高：跨语言平台重写与长期双栈维护 |

Tauri 的更小包体和 Rust 内存安全优势是真实的，官方也提供签名强制的 updater；但 TTool 当前并非简单 WebView 应用。以下能力都需迁移：

- Node 驱动的 MySQL、Redis、MongoDB 与 BSON/EJSON 类型保真；
- 通用 TCP/TLS socket 生命周期；
- safeStorage、插件目录与 GitHub 安装器；
- 多窗口截图、置顶贴图、全局快捷键、托盘与文件搜索；
- 外部插件同宿主 React/SDK 单例和动态 bundle 加载。

Tauri 官方架构与 updater：<https://v2.tauri.app/start/>、<https://v2.tauri.app/plugin/updater/>。

## 后续迁移触发条件

只有在以下条件至少满足两项时，再启动独立 Tauri PoC：

1. 安装包体积或常驻内存成为已测量的核心产品指标；
2. Electron 安全更新的维护成本不可接受；
3. 已有 Rust 维护能力并可长期维护 Node/Rust 双协议；
4. 插件运行时完成隔离设计，不再依赖同一渲染上下文的 `window.ttool`；
5. DB、网络、截图、插件安装的 Rust 端验收矩阵已明确。

PoC 应独立于正式发布链，不与功能版本升级同批合并。

## 本轮自检后的剩余项

| 优先级 | 观察 | 处理建议 |
| --- | --- | --- |
| P0（扩大分发前） | `0.2.0` 按内部使用决策允许未签名发布，Windows 会显示“未知发布者” | 扩大到非受控机器前配置 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`，恢复签名强制门禁，并以签名后的 Actions 产物作为唯一正式资产 |
| P1（内部机器增多时） | 私有 GitHub Provider 需要每台机器持有只读 token | 当前少量内部分发使用 `TTOOL_UPDATE_GH_TOKEN` 可接受；规模扩大后改用具备设备身份和短期凭证的受控更新服务，不把高权限 token 放入客户端 |
| P1（插件生态扩大前） | 外部插件仍与宿主页面共享渲染上下文，技术上可看到 `window.ttool` 的 first-party bridge | 当前更新安装必须经过主进程原生确认且来源固定；后续应把第三方插件迁到独立 WebContents/受限 preload，而不只是依赖 SDK 白名单约定 |
| P2 | React 19 最终构建的 Vite 主 chunk 为 590.43 kB（gzip 236.68 kB），超过默认 500 kB 提示线 | Electron 内部应用暂不为消除警告而重构；先测冷启动，再按工具边界使用 dynamic import 拆分 |
| P2 | Windows NSIS 安装包约 99.1 MiB | 属于 Electron 内置 Chromium 的预期成本；只有包体/内存成为已测量的产品指标时才触发 Tauri PoC |

这些剩余项不阻塞少量受控内部机器使用；签名和真实 `0.2.0 → 0.2.1` 验收仍是扩大分发范围前的发布门禁。
