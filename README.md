# Gather

> 本地优先、AI 修改可审阅的 Markdown 写作工作台。

Gather 把 Markdown 文件留在你的磁盘上，把编辑器的最终决定权留给你。它不把文稿锁进云端数据库，也不让模型在后台悄悄改写正文。Phase 0 只做一件事：把桌面壳、编辑器内核、CLI 和共享核心的地基搭起来，并让每一层都能被单独验证。

**当前状态：Phase 0 骨架开发中，未发布。** 版本号为 `0.1.0-phase.0`，不是可安装的发行版。本文档依据 2026-11-21 的工作区快照编写；依赖已安装，单元测试与类型检查已执行，CLI 的 `doctor/new/export` 已按仓库脚本验证；桌面端没有可复现的打开/保存/IME 手工矩阵记录。文中会明确区分“代码中存在”“已验证”“尚未验证”，不把计划写成结果。

## 目录

- [项目状态](#项目状态)
- [为什么做 Gather](#为什么做-gather)
- [当前 Phase 0 能力](#当前-phase-0-能力)
- [明确未完成项](#明确未完成项)
- [技术架构](#技术架构)
- [目录结构](#目录结构)
- [本地运行](#本地运行)
- [CLI 示例](#cli-示例)
- [路线图](#路线图)
- [P0 编辑功能清单](#p0-编辑功能清单)
- [工业级质量门槛](#工业级质量门槛)
- [Windows / Linux 分发与签名成本](#windows--linux-分发与签名成本)
- [GitHub Pages 项目站](#github-pages-项目站)
- [贡献](#贡献)
- [安全与隐私](#安全与隐私)
- [License](#license)
- [Trademark 注意](#trademark-注意)

## 项目状态

| 项目 | 现状 |
| --- | --- |
| 阶段 | Phase 0（骨架已落盘，发布门槛未满足） |
| 版本 | `0.1.0-phase.0`（私有 workspace，未发布） |
| 目标平台 | Windows 10/11；Linux（Ubuntu/Debian/Fedora，X11 与 Wayland） |
| 桌面壳 | Electron 38 + electron-vite 4（Phase 0 默认） |
| 编辑器核心 | CodeMirror 6 + Lezer |
| CLI | Node.js + Commander，`gather doctor/export/new` |
| 共享核心 | `@gather/core`，Markdown 渲染与文本计数 |
| 许可 | 应用核心 AGPL-3.0-only（`LICENSE` 已落盘）；插件 SDK/主题以后 MIT |
| 发布状态 | 没有安装包、没有签名、没有公开 beta、项目站未部署 |

Phase 0 的退出标准不是“功能多”，而是“每一层都能从干净环境跑起来，并且不丢稿”。当前快照还没有达到这个标准，具体差距见[明确未完成项](#明确未完成项)。本文档不声称 RAG、完整导出、安装包、签名或公开 beta 已完成；它们要么未开始，要么只有脚手架。

## 为什么做 Gather

**文件应该是文件。** 很多写作工具把内容存进私有数据库或云端工作区，导出只是事后补救。Gather 反过来：`.md` 文件是唯一真相，应用只是文件的编辑器。换一台机器、换一个编辑器、用 `git` 管理版本，文稿都还在。

**AI 不应该替作者做决定。** 常见的“AI 改稿”是一键重写，用户只能接受一个黑箱结果。Gather 的方向是：模型提出修改，界面展示逐块 diff，作者逐块接受或拒绝；没有审阅就不落盘。AI 是建议者，不是共同作者。

**Markdown 不需要被藏起来。** 富文本编辑器很舒服，但它们通常有自己的文档模型，保存时把 Markdown 重新序列化，脚注、表格、HTML、空行和换行符很容易被改写。Gather 直接编辑 Markdown 文本，实时预览只是文本上的装饰层，不是另一份文档。

Gather 不打算做这些事：

- 不做云端协作 SaaS，不要求账号，不做多人实时协同（至少 Phase 0–2 不做）。
- 不做 Notion 式块数据库，不引入私有文档格式。
- 不内置付费模型 API，不把“上传文档”当作默认行为。
- 不承诺“AI 自动写完一篇文章”。审阅是产品约束，不是可关闭的选项。

## 当前 Phase 0 能力

状态图例：

- **已落盘**：代码在工作区中存在。
- **已验证（本地）**：在 2026-11-21 的 Windows + Node 24.22.3 环境中实际执行通过；不代表 CI 或跨平台通过。
- **部分**：有实现，但覆盖范围或边界处理不完整。
- **未实现**：Phase 0 范围外，或尚未开始。
- **未验证**：代码存在，但没有完成对应验证（例如桌面手工矩阵、IME、CLI 运行），不能声称通过。

### 桌面应用（`apps/desktop`）

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| Electron 主窗口 | 已落盘 | 1200×820，最小 760×520，单实例锁 |
| 打开 Markdown | 已落盘 | 系统文件对话框，支持 `md/markdown/mdown/mkd/txt` |
| 保存 / 另存为 | 已落盘 | 主进程写文件，先写临时文件再 `rename` |
| 文件大小保护 | 已落盘 | 单文件上限 20 MiB，超出时拒绝打开/保存 |
| 进程隔离 | 已落盘 | `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false` |
| 应用菜单 | 已落盘 | 文件、视图、帮助菜单；打开/保存/另存为/切换预览 |
| 快捷键 | 已落盘 | `Ctrl/Cmd+O`、`Ctrl/Cmd+S`、`Ctrl/Cmd+Shift+S`、`Ctrl/Cmd+Shift+P` |
| 未保存提示 | 部分 | 标题栏脏标记与 `beforeunload`；没有崩溃恢复 |
| 文件变更监听 | 未实现 | 外部程序改动同一文件时不会提示冲突 |

### 编辑器（`packages/editor`）

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| CodeMirror 6 源码编辑 | 已落盘 | Markdown 语法、行号隐藏、自动换行、Tab 缩进 |
| GFM 解析 | 已落盘 | 使用 `@codemirror/lang-markdown` 与语言数据 |
| 撤销 / 重做 | 已落盘 | CodeMirror history |
| 搜索 | 已落盘 | CodeMirror search keymap |
| 实时预览装饰 | 部分 | 标题、粗体、斜体、行内代码、链接、引用、代码块、列表的样式；光标所在行会显示语法标记 |
| 预览开关 | 已落盘 | 通过 Compartment 动态启用/停用装饰 |
| 格式工具栏 | 已落盘 | 粗体、斜体、二级标题、引用、列表、行内代码、链接、代码块 |
| 中文/英文计数 | 已落盘 | `countText` 统计字符、词、行；CJK 按字计数 |
| 表格 / 图片渲染 | 未实现 | 预览层只做样式，不渲染表格和图片组件 |
| 链接点击 | 未实现 | 编辑器内不打开外链 |
| 输入法兼容性验证 | 未验证 | 没有 Windows/Linux IME 测试记录 |

### CLI（`packages/cli`）

| 命令 | 状态 | 说明 |
| --- | --- | --- |
| `gather doctor` | 已验证（本地） | 输出 Node、平台、工作目录；`--json` 输出结构化结果 |
| `gather export <file>` | 部分（本地验证） | 仅支持 HTML；PDF/DOCX 会明确报错 |
| `gather new <file>` | 已验证（本地） | 父目录必须存在；`wx` 模式拒绝覆盖已有文件 |
| 全局安装 | 未实现 | 没有发布 npm 包；Phase 0 通过仓库内路径运行 |

### 共享核心（`packages/core`）

- `renderMarkdown`：`marked` 解析 + `sanitize-html` 白名单过滤，禁止 `javascript:` 链接，图片允许 `http/https/data`。
- `renderDocumentHtml`：生成带打印样式的中文友好 HTML 文档。
- `countText`：字符、拉丁词、CJK 字、行数。
- 核心不依赖 Electron，CLI 与桌面端共用。

### 测试与站点

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 单元测试源码 | 部分 | `packages/core/test/markdown.test.ts`、`packages/editor/test/text-commands.test.ts` |
| 测试运行器配置 | 已落盘 | `vitest.config.ts`，匹配 `packages/**/test/**/*.test.ts` |
| 测试实际执行 | 已通过（本地） | 2026-11-21 在 Windows 上执行：2 个测试文件、12 个测试通过；尚未在 CI/Ubuntu 矩阵复跑 |
| 类型检查 | 已通过（本地） | 同一轮执行中，core/editor/desktop/CLI 四个 `tsc --noEmit` 均通过；尚未在 CI 复跑 |
| CLI 冒烟 | 已通过（本地） | `doctor`、`new`、`export --out`（HTML）可用；`--format pdf` 以非零状态拒绝；尚未在 Linux 复跑 |
| 构建产物 | 已生成（本地） | `apps/desktop/out`、`apps/site/dist`、`packages/cli/dist` 已生成；本次文档没有重新执行完整 `npm run build` |
| CI | 部分 | `.github/workflows/ci.yml` 已落盘；只覆盖 Ubuntu，且尚未产生绿色运行结果 |
| 官网骨架 | 已落盘 | `apps/site` 含 `index.html`、`styles.css`、`build.mjs`、`package.json`；`dist` 已构建，尚未部署 |
| 安装包 | 未实现 | `electron-builder` 配置存在，但没有安装包产物、没有签名 |

## 明确未完成项

这一节是 Phase 0 的收尾清单，不是“以后再说”的愿望清单。未勾选项目前都构成发布阻断。

- [ ] **测试与类型检查尚未在 CI 复跑。** 2026-11-21 本地 Windows 环境已通过 12 个测试与四个 `tsc --noEmit`；但没有 Windows/Ubuntu CI 绿色结果，不能把本地通过当成跨平台保证。
- [ ] **CI 覆盖不全。** `.github/workflows/ci.yml` 只跑 `ubuntu-latest`，没有 Windows 矩阵；`package-lock.json` 已生成，但工作流尚未产生绿色运行结果。
- [ ] **没有可复现的桌面验收记录。** CLI 的 `doctor/new/export` 已在 Windows 上冒烟通过；桌面端仍缺少打开/保存/另存/IME 矩阵记录，也没有 Linux 运行记录。
- [ ] **Markdown 行尾不保真。** CodeMirror 默认把 CRLF 规范化为 LF；打开再保存 CRLF 文件可能改变字节。BOM 也没有显式处理。
- [ ] **打开新文件后撤销栈可能保留旧文档。** 当前通过一次全文替换同步外部内容，没有在打开文件时重置 history；需要测试并修复。
- [ ] **没有外部文件变更检测。** 两个程序同时编辑同一文件时，后保存者会覆盖前者。
- [ ] **没有自动保存与崩溃恢复。** 只有未保存提示。
- [ ] **没有 CSP 与导航限制。** Electron 渲染进程已开启 sandbox，但 HTML 没有 Content-Security-Policy，主进程也没有显式的 `will-navigate` / `setWindowOpenHandler` 防护。
- [ ] **没有 AI 能力。** 没有 Ollama 客户端、没有 BYOK、没有 diff 审阅、没有逐块接受/拒绝。
- [ ] **没有 RAG。** 不在 Phase 0 范围，也没有代码。
- [ ] **没有完整导出。** 只有 HTML；PDF、DOCX 未实现。
- [ ] **没有安装包与签名。** `electron-builder` 只配置了目标格式，没有执行过 `package`/`dist`。
- [ ] **项目站未部署。** `apps/site` 的静态页、样式与构建脚本已落盘，`dist` 已构建；GitHub Pages 没有部署记录，URL 还不能访问。
- [ ] **没有商标/域名/包名检索记录。** `gather` 与 `@gather/*` 目前只是工作名称，未做商用清障。

## 技术架构

Gather 的分层原则是：**Markdown 文件是唯一真相，核心逻辑不依赖桌面壳，桌面壳不把 Node 能力暴露给页面。**

```text
                    ┌──────────────────────────────┐
                    │  Markdown 文件（UTF-8, .md） │
                    │  唯一真相，无私有数据库      │
                    └──────────────┬───────────────┘
                                   │ 读取 / 原子写入
                                   ▼
┌──────────────────────────────────────────────────────────────┐
│ apps/desktop（Electron）                                     │
│                                                              │
│  main 进程                 preload                 renderer  │
│  ├─ 文件对话框             ├─ openFile              ├─ React 19
│  ├─ fs 读写 / 临时文件     ├─ saveFile              ├─ 工具栏 / 状态栏
│  ├─ 菜单 / 单实例          ├─ saveFileAs            └─ @gather/editor
│  └─ IPC 处理               └─ onMenuAction                 │
│                                                           ▼  │
│                                      packages/editor（CM6）  │
│                                      ├─ Markdown 语言        │
│                                      ├─ 实时预览装饰        │
│                                      └─ 文本命令            │
│                                                 │            │
└─────────────────────────────────────────────────┼────────────┘
                                                  ▼
                                   packages/core（纯 TS）
                                   ├─ marked + sanitize-html
                                   ├─ HTML 文档模板
                                   └─ 文本计数
                                                  ▲
                                                  │
                                   packages/cli（Node）
                                   ├─ commander
                                   ├─ doctor
                                   ├─ export（HTML）
                                   └─ new
```

### 各层职责

| 层 | 职责 | 禁止事项 |
| --- | --- | --- |
| `packages/core` | Markdown 解析、白名单清洗、HTML 模板、计数 | 不依赖 Electron、DOM、React；不读写用户文件 |
| `packages/editor` | CodeMirror 状态与扩展、实时预览装饰、纯文本编辑命令 | 不直接访问 Node/Electron；不拥有文件路径 |
| `apps/desktop/main` | 文件对话框、原子写入、菜单、窗口生命周期、IPC | 不解析 Markdown 业务；不把 `ipcRenderer` 暴露给页面 |
| `apps/desktop/preload` | 最小 API 桥：打开、保存、另存、菜单事件 | 不暴露 `fs`、`child_process`、任意 IPC |
| `apps/desktop/renderer` | UI、编辑器挂载、脏状态、计数、预览开关 | 不启用 `nodeIntegration`；不加载远程脚本 |
| `packages/cli` | 终端工作流：体检、导出、新建 | 不依赖 Electron；不复制一套 Markdown 实现 |

### 为什么是 CodeMirror 6

Markdown 是文本，不是富文本 schema。CodeMirror 6 的文档模型就是字符串，Lezer 提供增量语法树，装饰层可以在不改变文本的前提下隐藏标记、放大标题、着色引用。保存时写回的是用户看到的同一段文本，不需要“从富文本模型序列化回 Markdown”这一步，因而更容易保住空行、表格、HTML 和未知语法。详细取舍见 [ADR 0002](docs/adr/0002-editor-core.md)。

### 为什么 Phase 0 是 Electron

Electron 在所有目标平台使用同一套 Chromium，中文输入法、字体回退、打印/PDF 的行为更容易保持一致；主进程直接使用 Node 的文件系统能力，CLI 与桌面端可以共享同一套 TypeScript 核心。代价是安装包大、内存高、需要跟随 Chromium 安全更新。Tauri 2 是候选，但必须先通过四项硬门槛，见 [ADR 0001](docs/adr/0001-desktop-shell.md)。

## 目录结构

```text
gather/
├─ apps/
│  ├─ desktop/                  Electron 桌面应用
│  │  ├─ src/main/index.ts      主进程：窗口、菜单、文件 IPC、原子写入
│  │  ├─ src/preload/index.ts   最小 contextBridge API
│  │  ├─ src/renderer/          React 渲染进程
│  │  ├─ electron.vite.config.ts
│  │  └─ package.json           electron-builder 目标：nsis/portable/AppImage/deb
│  └─ site/                     官网静态骨架
│     ├─ index.html             项目站首页（约 39 KB）
│     ├─ styles.css             站点样式（约 29 KB）
│     ├─ build.mjs              复制静态文件到 dist/
│     └─ package.json           @gather/site
├─ packages/
│  ├─ core/                     Markdown 渲染、HTML 模板、计数
│  │  ├─ src/markdown.ts
│  │  └─ test/markdown.test.ts
│  ├─ editor/                   CodeMirror 6 封装
│  │  ├─ src/index.tsx          React 组件与命令句柄
│  │  ├─ src/live-preview.ts    预览装饰
│  │  ├─ src/text-commands.ts   粗体/行前缀等纯函数
│  │  ├─ src/theme.ts
│  │  └─ test/text-commands.test.ts
│  └─ cli/                      gather 命令
│     └─ src/cli.ts             doctor / export / new
├─ docs/
│  ├─ adr/0001-desktop-shell.md
│  ├─ adr/0002-editor-core.md
│  └─ ROADMAP.md
├─ .github/workflows/
│  ├─ ci.yml                    Ubuntu + Node 24：ci/typecheck/test/build
│  └─ pages.yml                 构建 apps/site 并部署 GitHub Pages
├─ .nvmrc                       Node 24
├─ LICENSE                      GNU AGPL v3 全文
├─ package.json                 npm workspaces 根
├─ package-lock.json            依赖锁定（已生成）
├─ tsconfig.base.json
└─ vitest.config.ts
```

`dist/`、`out/`、`release/` 是生成目录，已在 `.gitignore` 中忽略；`apps/site/dist`、`apps/desktop/out`、`packages/cli/dist` 当前存在于工作区。

## 本地运行

### 环境要求

- **Node.js 24.x**。`.nvmrc` 写的是 `24`；根 `package.json` 的 `engines` 是 `>=22.13.0`，但文档与 CI 目标统一按 Node 24 执行，避免 Node 22 早期版本的类型剥离/工具链差异。
- npm（随 Node 安装）。仓库使用 npm workspaces，不要求 pnpm/yarn。
- Windows 10/11，或带桌面环境的 Linux。Electron 在 Linux 上需要 GTK3、NSS、ALSA 等运行库，具体包名以 Electron 官方 Linux 依赖说明和你的发行版为准。
- Phase 0 不需要 Rust、Python 或 Tauri 工具链。

切换 Node 版本（任选其一）：

```bash
nvm use 24
# 或
fnm use 24
```

### 安装与开发

在仓库根目录执行：

```bash
npm install
npm run dev
```

`npm run dev` 调用 `electron-vite dev`，启动桌面窗口并加载渲染进程。首次安装会下载 Electron 二进制，网络受限时需要配置镜像。

### 构建

```bash
npm run build
```

根脚本会依次构建桌面端、官网、CLI：

```text
npm run build -w @gather/desktop
npm run build -w @gather/site
npm run build -w @gather/cli
```

当前工作区已经生成三个 workspace 的产物（`apps/desktop/out`、`apps/site/dist`、`packages/cli/dist`），但本文档没有重新执行完整 `npm run build`，也没有在干净 clone 或 CI 中验证。需要单独构建时，可以直接运行上面的 workspace 命令。

### 测试与类型检查

```bash
npm test
npm run typecheck
```

`npm test` 等价于 `vitest run`，匹配 `packages/**/test/**/*.test.ts`。`npm run typecheck` 会依次对 core、editor、desktop、CLI 执行 `tsc --noEmit`。

**本地验证（2026-11-21，Windows）**：依赖已安装；以 Node 24.22.3 执行 Vitest（2 个测试文件、12 个测试）与四个 tsconfig 的 `tsc --noEmit`，均通过。仓库已有 `package-lock.json`，`npm ci` 具备执行条件，但本次没有运行；CI 的 Windows/Ubuntu 矩阵也尚未产生结果。Phase 0 收尾时必须让下面的命令在 Windows 11 与 Ubuntu 24.04 上同时通过：

```bash
npm ci
npm run typecheck
npm test
npm run build
```

### 桌面打包（未验证）

`apps/desktop/package.json` 中存在以下脚本，但它们不是 Phase 0 的完成项，也没有在本快照中执行：

```bash
# 只生成未打包目录，便于本地检查
npm run package -w @gather/desktop

# 生成安装包（Windows: nsis/portable；Linux: AppImage/deb）
npm run dist -w @gather/desktop
```

产物目录为 `apps/desktop/release/`。没有代码签名，没有自动更新，也没有在干净虚拟机中做过安装/卸载测试。

## CLI 示例

Phase 0 不发布全局 npm 包。先构建 CLI，再用仓库内路径运行。以下命令已在 2026-11-21 用 Node 24.22.3 在 Windows 上冒烟验证：`doctor`、`new`、`export --out`（HTML）成功，`export --format pdf` 按预期以非零状态失败；Linux 尚未复跑。

```bash
npm run build -w @gather/cli
node packages/cli/dist/cli.js --help
```

### `gather doctor`

```bash
node packages/cli/dist/cli.js doctor
node packages/cli/dist/cli.js doctor --json
```

输出 Node 版本、平台、当前目录，以及 AI 配置的占位说明。`doctor` 目前只按 Node 主版本判断 `>=22`，并没有精确比较 `22.13.0`；AI 字段是说明文本，不代表 AI 已实现。

### `gather new`

```bash
mkdir -p notes
node packages/cli/dist/cli.js new notes/today.md
```

父目录必须已存在。命令使用 `wx` 标志，目标文件已存在时会失败而不是覆盖。

### `gather export`

```bash
# 输出到 stdout
node packages/cli/dist/cli.js export notes/today.md

# 写入 HTML 文件
node packages/cli/dist/cli.js export notes/today.md --out notes/today.html

# 显式指定格式（Phase 0 只接受 html）
node packages/cli/dist/cli.js export notes/today.md --format html --out notes/today.html

# 预期失败：PDF 尚未实现
node packages/cli/dist/cli.js export notes/today.md --format pdf
```

`--format pdf` 会以非零状态退出并提示 Phase 0 只支持 HTML。`--json` 在配合 `--out` 时输出 `{ output, bytes }`；不配合 `--out` 时仍然输出 HTML 正文。

## 路线图

完整阶段、验收门槛与时间范围见 [docs/ROADMAP.md](docs/ROADMAP.md)。摘要：

| 阶段 | 目标 | 量级 | 关键出口 |
| --- | --- | --- | --- |
| Phase 0 | 可运行骨架：桌面编辑器、CLI、官网、测试、CI | 2 周（一人全职） | 干净环境四命令全绿；打开/保存不丢稿；站点可访问 |
| Phase 1 | 编辑可靠性与文件安全：CRLF/BOM、外部变更、恢复、IME、性能 | 4–6 周 | 8 小时 dogfood；IME 矩阵签字；5 MiB 文档可用 |
| Phase 2 | AI 审阅与 Tauri bake-off：Ollama、BYOK、逐块 diff | 6–10 周 | 默认不上传；逐块接受/拒绝；四项硬门槛有结论 |
| Phase 3 | beta 加固：PDF/DOCX、插件 SDK、签名分发、自动更新 | 3–5 个月 | 签名安装包；更新可回滚；插件 API 稳定 |
| Phase 4 | 1.0：稳定性、可访问性、本地化 | 3–6 个月 | 30 天无 P0 数据事故；文档与迁移路径完备 |

**公开 beta 的时间量级是 6–9 个月**（一人全职、按上述范围）。两到四人的小团队可以并行桌面、AI、站点与测试，beta 可能压缩到 3–6 个月，但 IME、Linux 发行版矩阵、签名与数据安全测试不能按人数线性压缩。兼职投入按 1.5–2.5 倍时间估算。以上是范围估算，不是发布日期承诺。

## P0 编辑功能清单

这里的 P0 指“不完成就不能进入 Phase 1 的编辑能力”。状态按当前代码快照判定，未运行验证的条目标为“未验证”。

| 编号 | 功能 | 优先级 | 状态 |
| --- | --- | --- | --- |
| P0-01 | 打开 UTF-8 Markdown，保留文本内容 | 必须 | 已落盘，未验证 |
| P0-02 | 保存 / 另存为，临时文件 + `rename` 原子替换 | 必须 | 已落盘，未验证 |
| P0-03 | 20 MiB 文件上限与错误提示 | 必须 | 已落盘 |
| P0-04 | Markdown 源码编辑、GFM 语法、撤销/重做、搜索 | 必须 | 已落盘 |
| P0-05 | 实时预览装饰与一键开关 | 必须 | 部分 |
| P0-06 | 光标所在行显示语法标记，避免“看不见光标” | 必须 | 已落盘 |
| P0-07 | 粗体/斜体/标题/引用/列表/代码/链接工具栏 | 必须 | 已落盘 |
| P0-08 | `Ctrl/Cmd+O/S/Shift+S/Shift+P` | 必须 | 已落盘 |
| P0-09 | 脏状态、窗口标题提示、关闭前提醒 | 必须 | 部分 |
| P0-10 | 中英文计数、行数 | 应该 | 已落盘 |
| P0-11 | CRLF/BOM 字节保真 | 必须 | 未实现 |
| P0-12 | 中文 IME（Windows 微软拼音/搜狗；Linux Fcitx5/IBus） | 必须 | 未验证 |
| P0-13 | 外部文件变更检测与冲突提示 | 必须 | 未实现 |
| P0-14 | 自动保存/崩溃恢复/备份 | 必须 | 未实现 |
| P0-15 | 打开新文件时重置撤销栈 | 必须 | 未实现 |
| P0-16 | 5 MiB 文档输入延迟与滚动性能 | 应该 | 未验证 |
| P0-17 | 表格、图片、链接的预览呈现 | 应该 | 未实现 |
| P0-18 | 多标签/工作区 | 以后 | 未实现 |
| P0-19 | AI diff 审阅与逐块接受/拒绝 | Phase 2 | 未实现 |
| P0-20 | PDF/DOCX 导出 | Phase 3 | 未实现 |

P0 的“必须”项没有全部满足，因此当前快照不能称为可发布的编辑器，只能称为骨架。

## 工业级质量门槛

以下是 Gather 进入 beta 前必须满足的门槛。它们不是营销指标，而是发布阻断条件。当前快照只满足其中很小一部分。

| 门槛 | 可验证标准 | 当前 |
| --- | --- | --- |
| 数据安全 | 强制杀进程、断电模拟、磁盘满、只读目录、并发保存后，原文可恢复；0 丢失 | 原子写入已落盘；恢复/备份未实现 |
| 字节保真 | 未修改的文稿打开再保存，字节一致；CRLF、BOM、无结尾换行、frontmatter、表格、HTML 块纳入 golden corpus | CRLF 会被规范化；无 golden 测试 |
| 编辑正确性 | 撤销/重做、选区、跨行命令、嵌套标记、emoji、CJK 标点的单元与属性测试通过 | 只有少量纯函数测试 |
| IME | Windows 微软拼音/搜狗、Linux Fcitx5/IBus 在 X11 与 Wayland 下无丢字、无重复、候选框定位正确、组合期间预览不跳动 | 未验证 |
| 性能 | 冷启动 ≤ 2 s；10 万字符输入 p95 ≤ 16 ms；1 MiB 文件打开 ≤ 1 s；空闲内存有基线 | 未测量 |
| 安全 | sandbox、contextIsolation、CSP、IPC 白名单、HTML 白名单、依赖审计、签名产物 | sandbox/contextIsolation/白名单部分已启用；CSP、依赖审计、签名缺失 |
| 可访问性 | 全键盘操作、焦点可见、200% 缩放、屏幕阅读器可读、对比度达标 | 未测试 |
| 跨平台 | Windows 10/11、Ubuntu 22.04/24.04、Fedora 当前稳定版；X11 与 Wayland 各一轮 | 未测试 |
| 交付 | Windows + Linux CI 全绿；安装/卸载/升级/回滚；校验和与签名 | CI 仅有 Ubuntu workflow 且未绿；安装包、签名均无 |

Phase 0 的目标是让这些门槛“可被执行”，不是全部通过。任何“已经工业级”的说法都不成立。

## Windows / Linux 分发与签名成本

Phase 0 的 `electron-builder` 配置已经写了目标格式，但没有构建过安装包，也没有证书：

- Windows：`nsis` 安装包与 `portable` 单文件。
- Linux：`AppImage` 与 `deb`，分类 `Office`。

### Windows

- 未签名的安装包会触发 SmartScreen 警告，用户需要多点一次“仍要运行”。这对写作工具是明显的信任损失。
- Authenticode 代码签名证书通常按年订阅。OV 证书大致在每年几百美元量级，EV 证书更高；具体价格随供应商、云签名/硬件令牌方案变化，需实际询价。
- 私钥必须放在硬件令牌或云 HSM 中，CI 签名需要额外的签名服务或自托管 runner。
- 时间戳服务应默认启用，否则证书到期后旧安装包的签名会失效。
- SmartScreen 信誉需要时间积累，签名不等于立刻没有警告。

### Linux

- AppImage 没有强制的中心化签名体系，可以用 GPG 对产物签名并提供校验和；deb 仓库同样用 GPG 签 `Release` 文件。
- 没有必须购买的代码签名证书，但有仓库托管、带宽、Flathub/Snap 审核与持续维护成本。
- 必须在 Ubuntu/Debian 与 Fedora 上分别测试 glibc、GTK、Electron/Chromium 运行库；Wayland 下的输入法、文件对话框、缩放要单独验证。
- 不建议 Phase 0 就承诺“全发行版支持”。先锁定 Ubuntu 22.04/24.04 与 Fedora 当前稳定版，再扩展。

### 共同成本

- CI 需要 Windows 与 Linux runner；签名通常需要单独的密钥管理方案。
- 自动更新需要签名、HTTPS 托管、版本清单与回滚策略，Phase 0 没有实现。
- 崩溃报告如果做，必须默认关闭或明确征得同意，且不能包含文稿内容。

Phase 0 不发布安装包。上面是预算与工程约束提示，不是已完成的能力。

## GitHub Pages 项目站

计划中的项目站路径：

```text
https://hhxpoint.github.io/gather/
```

说明：

- 该路径按当前维护者账号 `hhxpoint` 与仓库名 `gather` 推定；`apps/site/index.html` 的 canonical 与 `og:url` 已指向它。如果最终组织名或仓库名变化，页面与路径都必须同步修改。
- 站点源码在 `apps/site`：`index.html`、`styles.css`、`build.mjs`、`package.json`；`build.mjs` 把首页与样式复制到 `apps/site/dist`，该目录已生成。
- `.github/workflows/pages.yml` 已落盘，触发条件包含 `apps/site/**` 与 `package-lock.json`，用 `npm ci` 安装后构建并上传 `apps/site/dist`。
- 站点构建已在本地成功，`package-lock.json` 也已生成；但 Pages 工作流尚未运行，当前没有部署记录，上面的 URL 不应被当作可访问地址。
- 自定义域名需要 DNS、HTTPS 与商标/域名清障后再决定；在完成之前使用 `github.io` 子路径。
- 根 README 不使用绝对站点链接，避免仓库改名后产生死链。

## 贡献

开发、测试、提交规范、数据安全与 AI 隐私要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。Phase 0 最需要帮助的方向：

- 在 Windows 10/11 与 Linux（X11/Wayland）上做真实运行与 IME 测试，并记录系统、输入法、版本。
- 补齐 Windows CI 矩阵与 Pages 部署；在 Linux 上复跑 CLI 与桌面矩阵。
- 为 Markdown 保真建立 fixture 集：CRLF、BOM、frontmatter、表格、HTML 块、CJK、emoji、超长行。
- 审查 Electron 安全配置与 HTML 清洗规则。

不接受：伪造测试结果、伪造截图、把未验证的 AI 能力写进文档、提交真实用户文稿或密钥、引入默认上传/遥测。

## 安全与隐私

### 数据

- 文稿保存在用户选择的本地文件，不使用云端数据库，不要求账号。
- Phase 0 的桌面端没有遥测、分析 SDK 或远程字体/脚本。CLI 不发起网络请求。
- 保存采用临时文件 + `rename`，降低半写文件风险；但没有自动备份与崩溃恢复，重要文稿仍应使用 `git` 或外部备份。
- 单文件上限 20 MiB；CLI 没有同样的上限，处理大文件时需要自行注意内存。

### Electron 加固现状

已启用：`contextIsolation`、`sandbox`、关闭 `nodeIntegration`、最小 preload API、文件类型/大小检查、HTML 白名单清洗。

仍缺少：CSP、导航与新窗口拦截、IPC 参数完整校验、依赖漏洞扫描、签名构建、自动更新校验。不要因为“本地优先”就认为桌面端没有攻击面；打开不受信任的 Markdown 仍然会经过解析与 HTML 渲染。

### AI 隐私原则（Phase 2 才实现）

- 默认不联网、不上传文稿。AI 功能必须由用户显式开启。
- 本地推理优先使用 Ollama；云端使用用户自带 Key（BYOK），不内置任何付费 API。
- Key 存入操作系统凭据库，不写入明文配置、不写日志、不进仓库。
- 发送给模型的内容必须可见、可裁剪；默认不发全文，不做后台索引。
- 模型返回的修改只能进入 diff 审阅，逐块接受/拒绝后才写入文件；不自动改稿。
- 不使用用户文稿训练模型；不把文稿内容写入崩溃报告或分析事件。

Phase 0 没有 AI 代码，以上是后续实现的约束，不是现状。

### 漏洞报告

仓库尚未公开，也没有安全邮箱。公开后优先使用 GitHub Security Advisories 私下报告；在通道建立前，不要开公开 Issue 披露可利用细节。安全修复会随版本说明公布影响范围，但不会公开用户文稿。

## License

计划：**应用核心使用 AGPL-3.0-only**。根 `package.json` 已声明 `"license": "AGPL-3.0-only"`，仓库根目录已有 `LICENSE` 全文（GNU Affero General Public License v3）。插件 SDK/主题的 MIT 许可尚未落盘，因为对应包还不存在。

- `apps/desktop`、`packages/core`、`packages/editor`、`packages/cli` 计划统一为 AGPL-3.0-only。
- 插件 SDK、主题与示例以后计划使用 MIT，以降低生态接入门槛；它们会是独立包，并各自带 `LICENSE`。
- 第三方依赖遵循各自许可（例如 CodeMirror、React、Electron、marked、sanitize-html、Commander）。引入新依赖前必须检查与 AGPL 的兼容性。
- 不接受把核心代码改成更宽松许可的 PR，除非有单独的许可证决策记录。
- 贡献默认按所在组件的许可证授权；当前没有 CLA。

AGPL 的选择是为了让本地优先的桌面应用及其网络服务版本保持开源。它不是“禁止商用”；如果未来需要商业授权，必须单独决策并写清楚，不能靠 README 暗示。

## Trademark 注意

**Gather 目前只是工作名称，没有做商用清障。** `gather` 是常见英文单词，重名概率高；`@gather/*` 只是当前 workspace 作用域，不代表已获得 npm 组织名或商标权。

在公开 beta、收费、应用商店上架或成立公司之前，至少完成：

1. **商标检索**：中国国家知识产权局（CNIPA）、USPTO、EUIPO 等目标市场，覆盖第 9 类（软件）与第 42 类（SaaS/开发服务）。
2. **域名检索**：`gather.app`、`gather.dev`、`getgather.*` 等候选，确认不会与既有产品混淆。
3. **包名与账号检索**：npm 包 `gather`、GitHub 组织/仓库、PyPI、crates.io、Flathub、Snap Store、Microsoft Store。
4. **既有产品检索**：搜索引擎、GitHub、Product Hunt、应用商店，确认没有同品类的高知名度 Gather。
5. **法律意见**：如果计划商业化，让商标代理人做可注册性意见；本 README 不构成法律建议。

如果检索发现冲突，应在 beta 前改名，而不是等用户和文档积累后再改。改名成本包括仓库、包名、站点、签名证书、域名、文档与用户迁移说明。

---

相关文档：

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
- [ADR 0001：桌面壳选择](docs/adr/0001-desktop-shell.md)
- [ADR 0002：编辑器核心](docs/adr/0002-editor-core.md)

Gather 还没有发布。这里记录的是一个正在收尾的 Phase 0 骨架，以及把它做成可信写作工具所需的门槛。
