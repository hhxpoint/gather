# Gather 下载后怎么用

这份指南面向第一次下载 Gather 的人。应用不需要账号，打开文稿不需要联网；Markdown 文件始终留在你选择的本地文件夹。

当前版本是 [`v0.1.0-phase.0`](https://github.com/hhxpoint/gather/releases/tag/v0.1.0-phase.0) 未签名预览版。Windows 安装器可能触发 SmartScreen；Linux 图形会话、IME 与字体回退尚未实测。遇到问题请附系统版本与终端输出。

## 1. 选择并校验下载

| 系统 | 建议文件 | 适用方式 |
| --- | --- | --- |
| Windows 10/11 x64 | `Gather-Setup-0.1.0-phase.0.exe` | 安装版，创建开始菜单/桌面快捷方式 |
| Windows 10/11 x64 | `Gather-Portable-0.1.0-phase.0.exe` | 单文件运行，不经过安装器 |
| Linux x86_64 | `Gather-0.1.0-phase.0-linux-x86_64.AppImage` | 单文件 AppImage |
| Debian / Ubuntu amd64 | `Gather-0.1.0-phase.0-linux-amd64.deb` | 系统包管理器安装 |

下载页：[项目站下载区](https://hhxpoint.github.io/gather/#download) · [GitHub Release](https://github.com/hhxpoint/gather/releases/tag/v0.1.0-phase.0)

可选校验：

```powershell
# Windows PowerShell
Get-FileHash .\Gather-Setup-0.1.0-phase.0.exe -Algorithm SHA256
```

```bash
# Linux：把 SHA256SUMS.txt 与安装包放在同一目录
sha256sum -c SHA256SUMS.txt
```

完整 SHA-256 列表见 [Release 的 SHA256SUMS.txt](https://github.com/hhxpoint/gather/releases/download/v0.1.0-phase.0/SHA256SUMS.txt)。

## 2. 安装或直接运行

### Windows 安装版

1. 双击 `Gather-Setup-0.1.0-phase.0.exe`。
2. 若 SmartScreen 提示“未知发布者”，确认文件来源与 SHA-256 后，选择“更多信息 → 仍要运行”。这是未签名预览版的预期行为。
3. 选择安装目录，完成安装，从开始菜单或桌面启动 Gather。

### Windows 便携版

双击 `Gather-Portable-0.1.0-phase.0.exe` 即可运行，不需要安装。它仍会在用户配置目录保存窗口、工作区会话与恢复快照，不是“配置完全随文件走”的绿色版。

### Linux AppImage

```bash
chmod +x Gather-0.1.0-phase.0-linux-x86_64.AppImage
./Gather-0.1.0-phase.0-linux-x86_64.AppImage
```

如果系统缺少 FUSE 2 运行库，按发行版安装对应的 FUSE 2 包后再运行。Linux 桌面启动是当前最需要真实反馈的部分，尚未进入已验证矩阵。

### Linux deb

```bash
sudo apt install ./Gather-0.1.0-phase.0-linux-amd64.deb
```

安装后从应用菜单启动 Gather，或在终端运行 GUI 可执行文件 `gather`。需要 GTK3、NSS、ALSA 等 Electron 运行库。

## 3. 第一次打开

首次启动会显示一篇示例文稿，标题是“未命名文稿”。它只是起步内容，不会上传到任何服务器。

- **打开已有文稿**：`Ctrl+O`。当前公开构建只提供 Windows/Linux 安装包。
- **打开整个文件夹**：`Ctrl+Shift+O`。侧栏会递归列出 Markdown 文稿，点击即可切换。
- **另存为新文件**：`Ctrl+Shift+S`，选择保存位置和文件名。
- **保存修改**：`Ctrl+S`。Gather 不会自动改写原文件；标题栏的未保存标记消失才表示已写盘。

桌面端当前没有单独的“新建空白文稿”菜单。要在桌面端开始一篇新文稿，可以直接改写首次出现的未命名文稿并用“另存为”保存，或先用任意编辑器创建一个 `.md` 文件再打开。

## 4. 常用操作

| 操作 | 快捷键 / 位置 |
| --- | --- |
| 打开文件 | `Ctrl+O` |
| 打开文件夹工作区 | `Ctrl+Shift+O` |
| 保存 / 另存为 | `Ctrl+S` / `Ctrl+Shift+S` |
| 查找 / 替换 | `Ctrl+F` / `Ctrl+H` |
| 在工作区中查找 | `Ctrl+Shift+F` |
| 切换实时预览 | `Ctrl+Shift+P` |
| 阅读模式 | `Ctrl+Shift+R` |
| 专注模式 | `Ctrl+Shift+Enter` |
| 退出阅读/专注 | `Esc` |
| 导出 PDF | `Ctrl+Shift+E`，或“文件 → 导出 PDF…” |
| 导出 HTML | “文件 → 导出 HTML…” |

阅读模式包含目录、全文查找、代码语法高亮和纸色/夜读主题。专注模式隐藏侧栏与工具条，只留正文；`Esc` 返回。

## 5. 文稿、恢复与隐私

- 文稿保存在你打开或另存为的本地路径；Gather 不建立云端副本，也不要求登录。
- 未保存内容会定期写入恢复快照：Windows 为 `%APPDATA%\Gather\recovery`，Linux 通常为 `~/.config/Gather/recovery`。它是崩溃恢复，不是自动保存原文件。
- 强杀或崩溃后重启，应用会显示恢复横幅；点击恢复后仍需主动保存。
- 如果磁盘文件被其他程序修改，保存会被拒绝，并让你选择载入磁盘版本或另存为。不会静默覆盖外部内容。
- 恢复快照未加密，依赖操作系统账户权限；重要文稿仍应使用 `git` 或外部备份。
- 远程图片不会自动加载；文档目录内的本地图片会经边界校验后预览。

## 6. 升级与卸载

当前没有自动更新。新版本需要回到 [GitHub Releases](https://github.com/hhxpoint/gather/releases) 手动下载；不要从第三方站点获取安装包。

- **Windows 安装版**：设置 → 应用 → 已安装的应用 → Gather → 卸载。用户配置与恢复快照可能保留在 `%APPDATA%\Gather`，确认不再需要后再手动删除。
- **Windows 便携版**：删除 exe 即可；用户配置仍在 `%APPDATA%\Gather`。
- **AppImage**：删除 `.AppImage` 文件即可。
- **deb**：`sudo apt remove gather`。用户配置仍在 `~/.config/Gather`。

## 7. 遇到问题

| 现象 | 先检查 |
| --- | --- |
| Windows 提示“Windows 已保护你的电脑” | 确认下载来源为 `github.com/hhxpoint/gather`，核对 SHA-256；未签名预览版需要“更多信息 → 仍要运行” |
| Linux 双击 AppImage 没反应 | 先 `chmod +x`，再从终端运行看错误；检查 FUSE 2 与 GTK3/NSS 运行库 |
| 打开文件后无法保存 | 检查目录写权限、磁盘空间与文件是否只读；冲突横幅表示外部内容已变化 |
| 重启后出现“恢复快照” | 点击恢复，确认内容后用 `Ctrl+S` 保存；丢弃会删除该快照 |
| 切换文稿提示未保存 | 先保存或明确丢弃；Gather 不会静默替你选择 |
| 需要报告问题 | 附操作系统、Gather 版本、复现步骤、终端/界面错误文本；不要附带真实隐私文稿 |

## 8. 当前边界

- 安装包未签名，没有自动更新、升级/回滚或干净 VM 安装矩阵。
- Linux AppImage/deb 已构建并上传，但尚未在 Linux 图形会话、IME、字体回退与 200% 缩放下验收。
- 桌面端仍缺少阅读标注、精确段落/字符同步、打印专用版式、工作区树形新建/重命名/删除、跨文稿替换和 AI/RAG/DOCX。
- 详细验证证据与未验证项见 [VERIFICATION](VERIFICATION.md)；崩溃恢复、冲突拒绝与导出实现见 [README](../README.md) 与 [ADR](adr/)。
