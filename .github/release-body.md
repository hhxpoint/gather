# Gather 0.1.0

本地优先的 Markdown 写作工作台。文件留在磁盘，支持文件安全、恢复快照、工作区、搜索、阅读模式与 A4 PDF / HTML 导出。

## 下载

- **Windows 安装版**：`Gather-Setup-*.exe`
- **Windows 便携版**：`Gather-Portable-*.exe`（无需安装，直接运行）
- **Linux AppImage**：`Gather-*-linux-x86_64.AppImage`
- **Linux deb**：`Gather-*-linux-amd64.deb`
- **SHA-256**：`SHA256SUMS.txt`，请下载后校验。

```bash
# Linux / macOS
sha256sum -c SHA256SUMS.txt

# Windows PowerShell（逐个文件）
Get-FileHash .\Gather-Setup-0.1.0.exe -Algorithm SHA256
```

## 下载后怎么用

1. Windows 双击 `Gather-Setup-*.exe` 安装，或直接运行 `Gather-Portable-*.exe`。SmartScreen 提示时先确认来源与 SHA-256，再选择“更多信息 → 仍要运行”。
2. Linux AppImage 先 `chmod +x` 再运行；deb 用 `sudo apt install ./Gather-0.1.0-linux-amd64.deb`。
3. 启动后直接改写示例文稿，或按 `Ctrl+O` 打开已有 Markdown、`Ctrl+Shift+O` 打开文件夹；用 `Ctrl+Shift+S` 另存为新文件。
4. `Ctrl+S` 才会写回原文件，标题栏未保存标记消失才算成功；Gather 不会自动改写原文件。
5. `Ctrl+Shift+R` 阅读模式，`Ctrl+Shift+Enter` 专注模式，`Ctrl+Shift+E` 导出 A4 PDF。完整步骤、快捷键与故障排查见 [下载后怎么用](https://github.com/hhxpoint/gather/blob/main/docs/QUICKSTART.md)。

## 重要说明

- 这是 **Gather 0.1.0** 正式版本，未签名。Windows SmartScreen 可能提示“未知发布者”；只有在你信任此构建时才选择“仍要运行”。
- 没有自动更新、代码签名或干净 VM 安装/卸载矩阵；Linux 图形会话与 IME 矩阵仍未验证。
- 安装包不是 npm 包；CLI 源码仍从仓库运行。
- 系统要求：Windows 10/11；Linux 需要 Electron 的 GTK3/NSS/ALSA 等运行库。
- Linux：AppImage 先 `chmod +x Gather-0.1.0-linux-x86_64.AppImage`；deb 用 `sudo apt install ./Gather-0.1.0-linux-amd64.deb`。

## 验证

每个产物由 GitHub Actions 在同一提交上构建；校验和文件随 Release 上传。完整源码、测试与证据见仓库。
