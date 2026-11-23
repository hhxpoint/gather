# Gather Phase 1 Preview

本地优先的 Markdown 写作工作台。文件留在磁盘，支持文件安全、恢复快照、工作区、搜索、阅读模式与 A4 PDF / HTML 导出。

## 下载

- **Windows 安装版**：`Gather-Setup-*.exe`
- **Windows 便携版**：`Gather *.exe`（无需安装，直接运行）
- **Linux AppImage**：`Gather-*.AppImage`
- **Linux deb**：`Gather-*_amd64.deb`
- **SHA-256**：`SHA256SUMS.txt`，请下载后校验。

## 重要说明

- 这是 **Phase 1 预览**，未签名。Windows SmartScreen 可能提示“未知发布者”；只有在你信任此构建时才选择“仍要运行”。
- 没有自动更新、代码签名或干净 VM 安装/卸载矩阵；Linux 图形会话与 IME 矩阵仍未验证。
- 安装包不是 npm 包；CLI 源码仍从仓库运行。
- 系统要求：Windows 10/11；Linux 需要 Electron 的 GTK3/NSS/ALSA 等运行库。

## 验证

每个产物由 GitHub Actions 在同一提交上构建；校验和文件随 Release 上传。完整源码、测试与证据见仓库。
