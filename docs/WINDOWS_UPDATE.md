# TTool Windows 自动更新与 GitHub 发布

## 范围与行为

- 首期仅支持 Windows x64 NSIS 安装版。
- 安装版启动 15 秒后检查一次，之后每 6 小时检查；设置页也可手动检查。
- 发现版本后由用户确认下载；下载完成后再次通过主进程原生对话框确认重启安装。
- 开发态不会访问更新服务，web 和其它平台明确降级。
- `autoDownload=false`、`autoInstallOnAppQuit=false`，不会静默下载或在普通退出时偷偷安装。
- 安装前会切换主进程退出状态，避免现有“关闭主窗隐藏到托盘”逻辑拦住更新器。

核心实现：`electron/updater.cjs` → `electron/preload.cjs` → `src/platform/electron.ts` → 设置页。该能力是宿主内部 API，不属于插件 SDK。

## 更新源与内部仓库认证

electron-builder 配置使用私有 GitHub Releases `maoyugame/TTool` 的 `latest` channel。官方说明私有 GitHub Provider 需要客户端 token；每台内部机器应使用独立的 fine-grained personal access token：

1. GitHub 头像 → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**。
2. `Resource owner` 选择仓库所有者，`Repository access` 只选 `maoyugame/TTool`，`Repository permissions` 只设置 `Contents: Read-only`；设置 30–90 天过期时间。`Metadata: Read-only` 会自动附带。
3. token 只在创建完成时显示一次；立即放入目标机器的凭证交付流程，不要粘贴到聊天、Issue、`.env`、源码、日志或安装包。
4. 在 Windows“编辑当前用户的环境变量”中新增 `TTOOL_UPDATE_GH_TOKEN`。TTool 只在自身进程内把它映射成 electron-updater 所需的 `GH_TOKEN`，避免只读更新 token 覆盖同机 GitHub CLI 的登录凭证。
5. 注销并重新登录 Windows，启动 TTool 后手动检查更新。token 泄漏或机器退役时，在 GitHub token 页面只撤销该机器 token。

兼容性上仍可直接提供 `GH_TOKEN`，但开发机不建议永久设置：GitHub CLI 会优先使用该环境变量，导致其安全存储中的正常登录被只读 token 覆盖。超过少量机器或达到 GitHub fine-grained token 数量上限后，应改用 GitHub App + 短期安装令牌代理，而不是继续扩散长期 PAT。

如果未来允许公开二进制，应把 `build.publish[0].private` 改为 `false`；公开 GitHub Releases 客户端无需 token。electron-updater 官方流程：<https://www.electron.build/docs/features/auto-update/>。

## GitHub Actions

- `.github/workflows/ci.yml`：普通 push/PR 执行 `npm ci` 和 `npm run check`。
- `.github/workflows/release-windows.yml`：只响应 `v*.*.*` tag。
- Release workflow 验证 tag 与 `package.json` 版本一致，构建一个 x64 NSIS 安装包，校验 `latest.yml`、SHA-512、blockmap 和唯一文件名后才发布非草稿 Release。
- 发布 job 仅授予 `contents: write`，使用 GitHub 自动生成且任务结束即过期的 `GITHUB_TOKEN`；客户端 token 不进入 Actions。
- 所有外部 Action 都固定到官方 Release 对应的完整 commit SHA；升级 Action 时必须从官方 Release 页核对新 SHA，不能改回可漂移的主版本标签。
- 已存在的同名 Release 不会被覆盖，防止 tag/资产被悄悄替换。

仓库 Settings → Actions → General 必须允许 workflow 获取写权限；组织策略若强制只读，需要管理员单独放行。GitHub `GITHUB_TOKEN` 说明：<https://docs.github.com/actions/concepts/security/github_token>。

## GitHub CLI 认证

开发/发布机器使用 GitHub CLI 自己的浏览器 OAuth 登录，不与终端更新 token 共用凭证：

```powershell
gh auth login --hostname github.com --git-protocol ssh --web
gh auth status
gh repo view maoyugame/TTool
```

浏览器流程完成后，`gh` 默认把 token 存入系统凭证存储。不要使用 `--insecure-storage`，也不要把 PAT 写进命令行参数。当前仓库 remote 是 SSH；若 `gh auth login` 检测不到 SSH key，可让它创建/上传一个 key，或先按组织规范配置现有 key。

Actions 中的 `GITHUB_TOKEN` 不需要、也不能手工生成。GitHub 在每个 job 开始时自动创建短期 token，通过 `${{ github.token }}` 或 `${{ secrets.GITHUB_TOKEN }}` 使用，job 结束后失效；本项目 release job 只授予 `contents: write`。

## Windows 代码签名

当前仅面向受控内部机器，workflow 允许发布未签名安装包。构建后仍会用 `Get-AuthenticodeSignature` 检查安装包和主程序：两者必须一致为 `Valid` 或 `NotSigned`；混合状态、未知错误或无效签名都会阻止发布。未签名包会显示“未知发布者”，只能在明确接受该风险的内部范围分发。

需要启用传统 Authenticode `.pfx` 签名时，在仓库 **Settings → Secrets and variables → Actions** 添加：

- `WIN_CSC_LINK`：代码签名 `.pfx` 的 base64 内容或受控下载 URL
- `WIN_CSC_KEY_PASSWORD`：PFX 密码

两个 secret 都存在时 electron-builder 会自动签名，工作流会要求安装包和主程序都为 `Valid`。不要只配置其中一个。扩大到非受控机器前，应将签名重新设为强制门禁；若需要审批，可再迁移到受保护的 `windows-release` Environment。

证书取得路线：

1. **推荐用于外部分发**：向公开受信任 CA 申请 Windows OV Code Signing 证书，选择支持 CI/云密钥或可交付 PFX 的产品。EV 通常绑定硬件 token，不适合 GitHub-hosted runner。
2. **可选云签名**：Microsoft Azure Artifact Signing（旧名 Trusted Signing）适合 CI，但 public-trust 有地区和身份验证限制；使用时需建立 Signing Account、identity validation、certificate profile、Entra app/OIDC，并把 `win.azureSignOptions` 与 Azure 凭证接入 workflow，替换当前 PFX 路线。
3. **仅受控内网测试**：可用 `New-SelfSignedCertificate -Type CodeSigningCert` 创建测试证书，但必须通过 AD/Intune/人工方式把公共证书部署为目标机器信任根/受信任发布者。未部署信任链时仍会显示未知发布者，不应冒充公开签名。

不要把 PFX、私钥或密码提交到 Git。证书需要 RFC 3161 时间戳，确保签名在证书到期后仍可验证；electron-builder 默认配置时间戳服务。官方配置：<https://www.electron.build/docs/features/code-signing/>。

## 发布步骤

1. 修改代码并执行 `npm run check`。
2. 用 `npm version <新版本> --no-git-tag-version` 同步 `package.json` 与 lockfile。
3. 再执行 `npm run release:check` 和 `npm run electron:build:win`。
4. 执行 `npm run release:check:artifacts`，确认本地安装包与元数据一致。
5. 评审并提交代码后创建同版本 tag，例如 `v0.2.1`，再推送 tag。内部未签名发布必须在 Release 说明中保留风险提示。
6. 等待 `Release Windows` workflow 完成；不要手工替换 Release 中的 `latest.yml` 或安装包。

`0.2.0` 是引导版本：旧的 `0.1.0` 没有更新器，必须手工安装一次。随后用 `0.2.1` 做第一条真实自动更新验收。

## N → N+1 验收矩阵

至少在一台不含源码环境的 Windows x64 机器验证：

1. 安装并启动 N，确认设置页显示 `app.getVersion()`。
2. 发布 N+1，确认自动/手动检查均能发现版本与 release notes。
3. 下载进度可见；安装包、SHA-512、blockmap 对应同一次构建。
4. 点击“稍后”不退出；点击“重启并更新”后应用真正退出、安装、重启。
5. 重启后版本为 N+1，插件目录、storage、secrets、截图设置等 userData 保留。
6. 再检查显示最新版本；离线、401/404、损坏元数据和签名失败只产生可恢复错误，不破坏当前安装。

## 回滚

- 不重写 tag，不覆盖已发布安装包，不用相同版本号替换坏版本。
- 发现问题时先删除/下线有问题 Release 以阻止新检查，再发布更高 patch 版本修复；已经下载的版本不能假设会自动降级。
- 保留上一版安装包和手工下载路径，必要时由管理员执行人工回退。
