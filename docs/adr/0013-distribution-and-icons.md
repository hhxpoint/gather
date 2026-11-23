# ADR 0013：应用图标、安装包与 GitHub Releases 分发

- 状态：Accepted（2026-11-23 发布 `v0.1.0-phase.0`）
- 日期：2026-11-23
- 范围：`apps/desktop/build`、`apps/site`、`.github/workflows/release.yml`

## 背景

仓库已经有可运行的 Windows staging 目录包和项目站，但没有应用图标、安装器、公开下载或校验和。用户访问 GitHub Pages 时只能看到“暂无下载”。要把 Gather 呈现为完整产品，需要同时解决品牌资产、可安装产物、二进制托管和发布可验证性。

## 决策

1. **图标以 SVG 为源。** `apps/desktop/build/icon.svg` 是唯一设计源：深森林绿圆角板、米白打开书页、金色叶芽。由 Chrome 透明背景渲染成 1024 PNG，再用 Pillow 生成 512/32/180/192 与多尺寸 ICO（16–256）。运行时图标通过 `extraResources` 暴露给 BrowserWindow；Windows exe 与 NSIS 由 electron-builder 嵌入 `icon.ico`。
2. **Windows 同时提供安装版与便携版。** NSIS 非一键安装、允许选目录、创建桌面/开始菜单快捷方式；portable 单文件直接运行。文件名固定为 `Gather-Setup-<version>.exe` 与 `Gather-Portable-<version>.exe`，避免 GitHub 把带空格的文件名重写为点号。
3. **Linux 提供 AppImage 与 deb。** 与现有 electron-builder 配置一致，图标使用 1024 PNG；Linux GUI/IME 仍未验证，发布说明必须写明。
4. **GitHub Releases 托管二进制，Pages 只托管站点并链接 Release。** Pages 不塞入 100 MB 级安装包；下载页直接链接 Release 资产，另提供 SHA-256。Release 资产由 Actions 在同一提交构建，避免本地与线上产物混淆。
5. **发布工作流单点收口。** `.github/workflows/release.yml` 在 tag `v*` 或手动输入 tag 时，于 Windows/Ubuntu 构建，统一上传 artifact；publish job 先 checkout 以读取发布说明，再生成 `SHA256SUMS.txt` 并通过 `softprops/action-gh-release` 创建/更新 prerelease。`CSC_IDENTITY_AUTO_DISCOVERY=false` 明确不伪造签名。Linux 侧要求显式 `executableName`、`deb.packageName` 与 `linux.artifactName`，不能把 scoped npm 名带进路径。
6. **安装产物必须标注未签名。** 没有 Authenticode 证书、Apple 证书或 Linux GPG 发行密钥；站点/Release 写明 SmartScreen 可能警告、没有自动更新、没有干净 VM 安装/卸载矩阵。绝不把 unsigned 预览写成“生产签名安装包”。
7. **站点图标与产品图标同源。** 站点 favicon-32、apple-touch-icon、icon-192、favicon.svg 从同一 SVG 派生；`build.mjs` 复制 `assets/`，HTML head 显式声明。

## 被否方案

- **继续只提供 staging 目录包。** 用户要解压、找 exe、无快捷方式；不是完整产品。
- **把安装包提交进仓库或 Pages。** 仓库膨胀、Pages 不适合大二进制与版本化缓存；Release 是正确渠道。
- **直接用默认 Electron 图标。** 不具备品牌识别，也不符合“完整产品”要求。
- **伪造签名/下载计数/SmartScreen 结果。** 不可接受；没有证书就明确 unsigned。
- **只在本地构建、手工上传。** 无法证明产物对应哪个提交，也无法复现 Linux 包；Actions + checksums 更可审计。

## 后果与边界

- Release 需要 GitHub Actions 下载 electron-builder/NSIS/AppImage/fpm 工具；网络失败要重跑，不能把半成品上传。
- Windows 安装器可安装、便携版可启动；Linux AppImage/deb 由 Ubuntu runner 构建并上传，但未在图形会话运行，IME/字体矩阵仍未验证。
- 首个成功发布为 [45140138861](https://github.com/hhxpoint/gather/actions/runs/45140138861)，prerelease 为 [v0.1.0-phase.0](https://github.com/hhxpoint/gather/releases/tag/v0.1.0-phase.0)。四个产物的 SHA-256 已与 GitHub API `asset.digest` 和 `SHA256SUMS.txt` 交叉核对；受本机到 release-assets 的网络限速影响，未从 Release 重新下载全部大文件。
- 下载页随 PR [#35](https://github.com/hhxpoint/gather/pull/35) / [#37](https://github.com/hhxpoint/gather/pull/37) / [#39](https://github.com/hhxpoint/gather/pull/39) 上线并补充安装说明与 [下载后怎么用](../../docs/QUICKSTART.md)；Pages [45148678830](https://github.com/hhxpoint/gather/actions/runs/45148678830) 成功。公网 HTML（LF 归一）SHA-256 `0ecc3d7a…` 与本地 `dist` 一致，1440/390 无横向溢出，5 个链接均指向真实 Release 资产。
- 未签名产物会触发 SmartScreen；自动更新、回滚、签名、干净 VM 安装/卸载仍属于后续发布门槛。
- 图标源文件与生成 PNG/ICO 都进入仓库；ICO 为 PNG 压缩条目（Windows Vista+），electron-builder/Windows 10/11 可读。
