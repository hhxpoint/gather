# Gather 验证矩阵

快照日期：2026-11-21。这里记录“实际执行过什么”，并明确哪些平台/场景没有执行。过时结果应更新或标注为历史基线，不能把计划写成结论。

## 环境

| 环境 | 版本/说明 |
| --- | --- |
| 本地系统 | Windows 11 x64 |
| 本地 Node | Electron 38.8.6 内置 Node 22.22.0（系统默认 Node 20 不支持所需的 `require(ESM)`） |
| CI | GitHub Actions `ubuntu-latest` 与 `windows-latest`，Node 24 |
| 桌面壳 | Electron 38 + electron-vite 4 |
| 编辑器 | CodeMirror 6 + Lezer |
| 仓库 | `hhxpoint/gather`，main |

## 可复现命令

```bash
npm ci
npm run typecheck

# Windows 本地（使用 Electron 自带 Node 22）
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe \
  ./node_modules/vitest/vitest.mjs run --config vitest.config.ts

# Linux/macOS 或 Node 22/24
npm test

npm run build
node packages/cli/dist/cli.js doctor --json

# 未签名便携目录包（不依赖 electron-builder 网络工具）
npm run stage -w @gather/desktop

# Windows 产物
apps/desktop/release/win-unpacked/Gather.exe
```

本地 `npm test` 需要 Node 22/24；系统 Node 20 会在 `sanitize-html` 的 ESM 依赖链或 Vitest reporter 上失败。

## 自动化测试清单

当前 9 个测试文件、75 个测试（Windows 上 73 通过、2 个 POSIX-only 测试跳过；Ubuntu CI 预期全部执行）：

| 文件 | 数量 | 覆盖 |
| --- | --- | --- |
| `packages/core/test/markdown.test.ts` | 7 | GFM、HTML 清洗、链接/图片协议、A4 打印规则、文档模板、计数 |
| `packages/core/test/text-format.test.ts` | 10 | LF/CRLF/BOM、混合行尾、无结尾换行、跨 IPC 校验 |
| `packages/editor/test/text-commands.test.ts` | 6 | 选区包装、行前缀、插入 |
| `apps/desktop/test/file-io.test.ts` | 11 | 真实临时目录 round-trip、外部修改拒绝、Save As、20 MiB、POSIX 只读目录 |
| `apps/desktop/test/file-watcher.test.ts` | 4 | 外部修改、自写忽略、删除/重建、轮询差异 |
| `apps/desktop/test/recovery.test.ts` | 9 | 快照读写/覆盖/丢弃/损坏/写删串行、注入失败、POSIX 只读目录 |
| `apps/desktop/test/atomic-write.test.ts` | 9 | ENOSPC/EIO/EACCES、sync/close/rename 失败清理 |
| `apps/desktop/test/file-errors.test.ts` | 10 | OS 错误中文映射、IPC 前缀清理 |
| `apps/desktop/test/export-html.test.ts` | 9 | 相对图片 data URI、URL 编码文件名、目录逃逸拒绝、SVG/缺失告警、代码块不误伤、远程/data 图片、目录消失、文件名清洗 |

Phase 1 前批 CI 基线：

- 恢复批次：[44885022294](https://github.com/hhxpoint/gather/actions/runs/44885022294)（40 个测试）。
- 故障注入批次：[44886639093](https://github.com/hhxpoint/gather/actions/runs/44886639093)（63 个测试）。
- 可复现性批次：[44888732915](https://github.com/hhxpoint/gather/actions/runs/44888732915)：Ubuntu 65 个测试全部通过（含 2 个真实 POSIX 只读目录测试）；Windows 63 通过、2 个 POSIX-only 跳过，job 成功。
- 打包 spike：[44892062198](https://github.com/hhxpoint/gather/actions/runs/44892062198)：类型检查、65 个测试、构建与 CLI 冒烟通过；CI 不执行 staging 脚本，打包运行是本机手工验证。
- Phase 0：Windows/Ubuntu [44870544811](https://github.com/hhxpoint/gather/actions/runs/44870544811) 全绿；Pages [44870544823](https://github.com/hhxpoint/gather/actions/runs/44870544823) 成功。

## Windows 真实窗口矩阵

已实际执行：

- 生产构建启动、窗口显示、编辑器加载。
- 打开 Markdown、源码/实时预览切换、编辑、保存、另存为。
- BOM + CRLF 文稿保存后 42 字节逐字节一致。
- 打开 20 MiB+1 文件被拒绝，当前文稿保持不变，状态无 IPC 前缀。
- 编辑 `crlf-bom.md` 后打开 `lf.md`，Ctrl+Z 不回到上一篇。
- 外部改写后 Ctrl+S 被拒绝，外部内容保留；“另存为”恢复成功。
- 编辑后等待快照、`taskkill /F` 强杀、重启显示恢复横幅；恢复后保存清除快照。
- 未命名文稿快照恢复并通过另存为落盘。
- 外部改写/删除触发实时提示；载入磁盘版本成功。
- 从恢复快照进入路径文稿后，外部改写仍触发提示。
- 打开另一个文件后旧恢复快照保留在 userData。
- 原子写入重构后正常保存成功，目标目录无临时文件残留。
- CDP 实测生产 `file://` 响应带 CSP，内联脚本被 `script-src-elem` 阻止。
- Windows staged 目录包 `Gather.exe` 启动，打开 Markdown、编辑、保存成功；`resources/app` 路径、preload、renderer、userData 均正常。
- 最终 staging 构建打开合成文稿，通过文件菜单快捷键 `Ctrl+Shift+E` 打开导出 PDF 对话框；保存为 418,240 bytes。
- 同一窗口工具栏导出 HTML，保存为 273,742 bytes；状态栏分别显示“已导出 export-demo.pdf · 408 KB”“已导出 export-demo.html · 267 KB”。

## 导出与 PDF 矩阵

| 项 | 方式 | 结果 |
| --- | --- | --- |
| PDF 页面 | 隐藏 `BrowserWindow` + `printToPDF`，A4，`preferCSSPageSize` | 4 页；`%PDF-1.4` 头；418,240 bytes |
| PDF 文字 | `pdfjs-dist` `getTextContent()` | 4 页中文完整：标题、表格单元格、代码块、段落、列表 |
| PDF 视觉 | `pdfjs-dist` + `@napi-rs/canvas` 渲染 PNG | 页面 1/3 可见中文标题、GFM 表格、页边距与嵌入的本地截图 |
| PDF 工具误判 | `pdftotext -layout` | 仅抽到 Latin，中文为空；被 `pdfjs-dist` 结果推翻，不据此判定 PDF 缺字 |
| HTML 本地图片嵌入 | 文本检查 | 1 个 `data:image/png;base64`；0 个 `src="assets/gather-editor.png"`；1 个 `<table>`；`@page` 规则存在 |
| HTML 视觉 | headless Chrome 打开导出的 HTML 并截图 | 中文标题、表格、代码块和图片正常，无缺失资源图标 |
| 图片目录逃逸 | 单元测试（真实临时目录） | Windows 绝对路径告警、不嵌入；目录外 symlink 也会经 `realpath` 拒绝 |
| 非位图/缺失/目录消失 | 单元测试 | SVG、缺失文件、文稿目录删除都只产生告警，HTML 仍导出 |
| 导出写盘 | 真实窗口 + 原子写 | 目标文件生成；失败路径复用临时文件 + fsync + rename，不留下半文件 |
| 远程图片 | 设计边界 | 不内嵌为 data URI；打开 HTML 或打印 PDF 时依赖网络；本次合成文稿未依赖远程图 |
| DOCX / CLI PDF | 未实现 | 不应在站点或 README 声称可用 |

PDF 验收复现命令（PDF 渲染依赖已有 `pdfjs-dist`/`@napi-rs/canvas`；本仓库不把它们加入运行时依赖）：

```bash
# 文本与页面回渲染
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe \
  /path/to/render-pdf.mjs

# 仓库内展示图来自真实 PDF 页面，不是 HTML 截图
docs/images/gather-pdf-export.png   # 952×1348，PDF 第 1 页
```

## 展示与站点

| 项 | 方式 | 结果 |
| --- | --- | --- |
| 产品截图 | staged Windows 应用 + CDP `Page.captureScreenshot` | 3 张真实截图：编辑器、恢复快照、外部修改拦截；无窗口装饰、无真实用户路径 |
| 示例内容 | 合成 Markdown，公开示例目录 `C:\Users\Public\...` | 不含真实用户文稿或账户 ID |
| 本地站点构建 | `npm run build -w @gather/site` | 通过；静态页面、样式与 `images/` 截图复制到 `dist` |
| 桌面视口 | 1440×1400，headless Edge + CDP | hero、产品、能力、CLI、构建、路线图分段检查；`scrollWidth = clientWidth` |
| 移动视口 | 390×844，CDP mobile emulation | top、product、download 检查；修复 Phase chip、状态栏与表头挤压 |
| 公网 Pages | build / deploy 两个 job | [44912794773](https://github.com/hhxpoint/gather/actions/runs/44912794773) 成功；build 14s、deploy 9s |
| 公网内容 | in-app Browser + headless Edge | Phase 1 标题、产品/能力/构建/路线图与 3 张截图均上线 |
| 公网截图资源 | `fetch` 三张图片 | HTTP 200，`image/png`，201,493 / 195,748 / 219,209 bytes，与仓库一致 |
| 新导出卡片桌面 | 本地构建，1440 视口 | `scrollWidth = clientWidth = 1422`；PDF 预览图与 A4/PDF 标签可见 |
| 新导出卡片窄屏 | CDP `Emulation.setDeviceMetricsOverride` 390×844 | `scrollWidth = clientWidth = 390`；四张图片 `naturalWidth` 均非零；导出卡片单列完整显示 |
| 窄屏 QA 误判 | headless Chrome `--window-size=390` | 实际布局视口最小 500，截图被裁切；不作为移动端溢出证据 |

## 打包矩阵

| 目标 | 方式 | 结果 |
| --- | --- | --- |
| Windows 目录包 | `npm run stage -w @gather/desktop`，复制 Electron dist + out | 通过：328 MB，`Gather.exe` 可运行并保存文稿 |
| staging 可执行文件校验 | 本地 Windows 构建 | `Gather.exe` 210,149,888 bytes；SHA-256 `62c62d170a95aa4a3eb3df05f0d56a3654ab4344f7452e21dea1334afed7100f`（重建会变化，不是发布校验和） |
| staging 主进程 bundle | 本地 Windows 构建 | `resources/app/out/main/index.js` 31,340 bytes；SHA-256 `261af9393c845a851dace38551183a7652b45a571c8c7f95081f2588c119df77` |
| Windows NSIS/portable | electron-builder | 未产出：第二次远程工具请求 600 秒超时；已记录并保留配置 |
| Linux AppImage/deb | electron-builder | 未执行（无 Linux 桌面环境） |
| 代码签名 | — | 未做；无证书 |
| 自定义图标 | — | 未做；staging 使用 Electron 默认图标 |
| 安装/卸载/升级/回滚 | — | 未做 |
| 自动更新 | — | 未实现 |

## 失败与恢复矩阵

| 场景 | 方式 | 结果 |
| --- | --- | --- |
| 写入 ENOSPC | 注入 `open/write` 失败 | 临时文件清理，未 rename |
| sync/close 失败 | 注入 | 临时文件清理，未 rename |
| rename EACCES | 注入 | 临时文件清理，原文件保留 |
| 快照替换失败 | 注入 + 真实旧快照 | 旧快照仍可读 |
| 目录不存在 | 真实临时目录删除 | ENOENT，目录状态不变 |
| POSIX 只读目录 | 真实 `chmod 0500` | Ubuntu CI 通过：EACCES，原文件与旧快照保留；Windows 跳过 |
| 20 MiB 读取 | 真实 sparse 文件 | 拒绝读取 |
| CRLF 编码膨胀 >20 MiB | 真实字符串 | 拒绝写入 |
| 本体外部修改 | 真实第二进程写文件 | 实时提示 + 保存拒绝 |
| 强杀进程 | `taskkill /F` | 重启恢复快照 |
| 真实磁盘满 | 未执行 | 未验证 |
| 断电/掉电 | 未执行 | 未验证 |
| 只读挂载/文件系统 | 未执行（仅 POSIX 目录 chmod；Ubuntu CI 已通过） | 部分验证 |
| 8 小时 dogfood | 未执行 | 未验证 |

## 未验证边界

- Windows 微软拼音/搜狗、Linux Fcitx5/IBus、X11/Wayland 的 IME 真机矩阵。
- Linux 图形会话启动、文件对话框、菜单、打印。
- 5 MiB/10 万字符性能、冷启动、内存基线。
- 200% 缩放、屏幕阅读器、全键盘可达性。
- 安装包（NSIS/portable/AppImage/deb）、签名、自动更新、回滚。
- 真实满盘、只读挂载、断电、网络文件系统、文件锁。
- AI/RAG、DOCX、CLI PDF、Tauri bake-off。
- 远程图片离线导出、页眉/页脚/页码/目录、不同平台字体一致性。
- 导出 20 MiB 边界、真实磁盘满时 PDF/HTML 写盘、只读目标目录。

## 维护

- 每次功能/修复批次更新本文件与 [DEBUG_LOG.md](DEBUG_LOG.md)。
- 只写实际执行过的命令与结果；本地结果与 CI 结果分开。
- CI 链接使用具体运行号；不要写“应该能过”。
- 失败矩阵中“注入”与“真实环境”必须分开，不能互相替代。
