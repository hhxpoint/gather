# ADR 0005：桌面导出走同一条清洗 HTML 与隐藏窗口 PDF

- 状态：Accepted
- 日期：2026-11-21
- 范围：`apps/desktop`、`packages/core`

## 背景

Phase 1 的目标是让 Markdown 文件可用、可带走。CLI 已经能导出 HTML，但桌面端只能保存 `.md`。用户需要：

- 从当前编辑器内容导出，而不是只导出上次保存的磁盘版本；
- 中文、GFM 表格、代码块、相对路径图片在 PDF 与 HTML 中一致；
- 导出失败时不留下半个文件，不把任意本地文件读进渲染层；
- 不引入付费云服务、不需要联网的转换工具。

## 决策

1. **Markdown 仍在核心清洗。** 桌面主进程调用 `renderDocumentHtml`，使用与 CLI、项目站同一套 `marked` + `sanitize-html` 白名单；渲染层不拼接 HTML，也不把未经清洗的字符串交给导出窗口。
2. **HTML 与 PDF 共用同一份 HTML。** HTML 导出直接原子写入目标文件；PDF 把同一份 HTML 写入系统临时目录，由隐藏 `BrowserWindow` 加载后调用 `webContents.printToPDF`。不使用外部 Pandoc/LaTeX 依赖。
3. **PDF 使用 A4 与 CSS 分页。** 核心模板加入 `@page { size: A4; margin: 19mm 17mm 21mm; }`、表头重复、表格行/引用/图片避免断行与 `print-color-adjust`。隐藏窗口用 `preferCSSPageSize: true`、背景打印和 tagged PDF。
4. **相对路径本地图片嵌入为 data URI。** 只接受 png/jpg/jpeg/gif/webp/avif/bmp；路径必须经 `realpath` 后仍位于文稿目录内；单图 8 MiB、整篇 24 MiB 预算；目录外、SVG、缺失和超预算只产生告警，不泄漏绝对路径，也不阻断其余内容。
5. **导出窗口最小权限。** `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、`javascript: false`、`webSecurity: true`；禁止新窗口。导出 IPC 校验格式、Markdown 大小与文件名，并走现有错误映射。
6. **目标文件原子替换。** PDF/HTML 字节先写临时文件、`fsync`、再 `rename`；失败时清理临时文件，不留下半个导出文件。
7. **导出使用当前编辑器文本。** 不要求先保存；如果文稿未保存，没有文稿目录，因此相对图片不嵌入，状态栏会显示导出已完成但可能带图片提示。

## 被否方案

- **CLI 生成 PDF。** CLI 没有 Chromium 打印链路；引入 LaTeX/Pandoc 会增加数百 MB 依赖并破坏跨平台可复现性。当前 CLI 只输出 HTML。
- **在渲染层生成 PDF。** 渲染层没有可靠的文件保存与打印权限；把任意 HTML 交给主进程会扩大攻击面。
- **直接使用 `file://` 相对图片。** 导出目标目录通常不同于文稿目录，且会把本地文件边界交给 Chromium；data URI 可移植且边界可控。
- **允许 SVG 嵌入。** SVG 可含脚本/外部引用；当前只嵌入位图，SVG 给告警。
- **一次性读取全部本地图片不设预算。** 会导致内存峰值和超大导出文件；使用单图与总量预算。

## 后果与边界

- 优点：无额外运行时依赖；HTML/PDF 内容一致；中文与表格已在真实 Windows 构建验证；HTML 单文件即可分享。
- 局限：远程 `http(s)` 图片不作为 data URI 内嵌，打开导出文件或生成 PDF 时依赖网络；PDF 暂不提供页眉/页脚、页码、目录或 DOCX；不同平台系统字体可能导致细微排版差异；隐藏窗口等待 250 ms 只用于布局/字体稳定，不保证慢网络图片加载完成。
- 当前验证：4 页 A4 PDF 418,240 bytes，中文/GFM 表格/代码块/本地图片经 `pdfjs-dist` 回渲染确认；HTML 273,742 bytes，包含 `data:image/png;base64`，无残留 `src="assets/...`。
- 防回归：新增导出格式必须复用 `buildExportDocument` 或明确说明为何不能复用；改动打印 CSS 必须用真实中文文稿重新导出并回渲染；新增图片类型必须同时更新边界测试。

## 复现

```bash
npm run build -w @gather/desktop
npm run stage -w @gather/desktop
# 启动 apps/desktop/release/win-unpacked/Gather.exe
# 打开含中文、表格、代码块与 assets/*.png 的文稿
# 工具栏导出 PDF / HTML，检查文件大小、页数、图片与文本
```

自动化边界测试：

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe \
  ./node_modules/vitest/vitest.mjs run apps/desktop/test/export-html.test.ts
```
