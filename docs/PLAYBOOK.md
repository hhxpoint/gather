# Gather 工程手册

> 面向后续维护者、贡献者和学习者的工程经验沉淀。最后更新：2026-11-23。
>
> 本手册解释“为什么这样做、怎么验证、踩过哪些坑、下一次如何避免”。逐条故障记录在 [DEBUG_LOG.md](DEBUG_LOG.md)，功能矩阵在 [VERIFICATION.md](VERIFICATION.md)，架构取舍在 [ADR](adr/)。三者是证据，本手册是索引与方法。

## 0. 怎么读

推荐顺序：

1. 根 [README](../README.md) 与 [ROADMAP](ROADMAP.md)：产品定位、阶段目标、明确不做的事。
2. [ADR 0001](adr/0001-desktop-shell.md) 与 [ADR 0002](adr/0002-editor-core.md)：Electron + CodeMirror 的基础选择。
3. [ADR 0003](adr/0003-file-safety.md) 到 [ADR 0007](adr/0007-workspace.md)：文件安全、恢复、导出、预览与工作区。
4. [ADR 0008](adr/0008-search.md) 与 [ADR 0009](adr/0009-workspace-search.md)：单文件查找与跨文稿搜索。
5. [DEBUG_LOG](DEBUG_LOG.md) 的 P1-24 到 P1-30：最近几批真实失败、根因与防回归。
6. [VERIFICATION](VERIFICATION.md)：当前能复现的命令、矩阵和未验证项。
7. 本手册第 2–8 节：把单点经验放回工程方法。
8. 源码阅读，推荐顺序：`packages/core` → `packages/editor` → `apps/desktop/src/main` → `preload` → `renderer` → `apps/site` → `packages/cli`。

证据分级必须写清楚：

| 级别 | 含义 | 能证明什么 |
| --- | --- | --- |
| 本地 | 本机真实执行 | 这台机器、这个构建、这个时间点可用 |
| CI | GitHub Actions 干净 runner | 类型检查、测试、构建可复现 |
| staging | 未签名 Windows 目录包（Linux 未跑） | Electron 运行时与真实窗口路径可用 |
| 公网 | GitHub Pages + HTTP 哈希 | 部署产物与仓库构建一致 |
| 注入/单元 | 模拟失败或纯函数测试 | 特定边界被覆盖，不代表整机可用 |
| 未验证 | 没有执行记录 | 不能声称通过 |

## 1. 不可动摇的产品约束

Gather 是本地优先的 Markdown 写作工作台，不是云协作 SaaS，也不是“AI 一键写完”。

- **Markdown 文件是唯一真相。** 预览、装饰、搜索结果、导出都从源文本派生，不维护第二份文档模型。
- **本地优先。** 文稿留在用户磁盘；不要求账号、不默认上传、不把云同步当顺手功能。
- **免费且离线可用。** 不依赖付费云 API；未来 AI 采用本地模型与用户自带 key（BYOK）。
- **审阅优先。** AI 输出只能进入 diff，逐块接受或拒绝后才落盘；不存在静默自动改稿。
- **Windows / Linux 桌面 + 一等 CLI。** CLI 不是桌面端的配件，读写同一批文件、遵守同一条边界。
- **工业级不是“功能多”。** 是字节保真、失败可恢复、路径有边界、结论可复核、边界敢写明。
- **不伪造。** 不编造下载链接、测试数、截图、跨平台结果或用户文稿；公开截图使用公共示例目录与合成内容。
- **审美是产品的一部分。** 安静、留白、克制的写作界面；不堆 SaaS 卡片与营销口号。

这些约束会直接决定技术选择。例如：为了“文件是唯一真相”，预览只能用 CodeMirror Decoration；为了“本地优先”，搜索不能偷偷把全文上传到服务端。

## 2. 架构地图与不变量

```text
Renderer (React, sandbox, no Node)
   │  minimal contextBridge API
   ▼
Preload (contextBridge only)
   │  ipcRenderer.invoke
   ▼
Main process (windows, dialogs, file I/O, recovery, workspace root)
   │  utilityProcess.fork
   ▼
Workspace search worker (Node, no window, bounded scan)
```

| 层 | 职责 | 不能做 |
| --- | --- | --- |
| `packages/core` | Markdown → 清洗 HTML、A4 文档、文本格式、计数 | 依赖 Electron / DOM |
| `packages/editor` | CodeMirror 扩展、预览装饰、搜索面板、编辑器句柄 | 读盘、持有工作区根路径 |
| `apps/desktop/main` | 窗口、菜单、对话框、文件 I/O、冲突检测、恢复、导出、工作区边界 | 把 Node 暴露给页面 |
| `apps/desktop/preload` | 最小 API 白名单 | 透传 `ipcRenderer` 或 `fs` |
| `apps/desktop/renderer` | React UI、编辑状态、搜索面板、状态提示 | 直接 `require`、直接读绝对路径 |
| `packages/cli` | `doctor/export/new` | 伪造 PDF/DOCX 能力 |
| `apps/site` | 静态项目站 | 伪造下载或功能截图 |

核心不变量：

1. **Markdown 原文是数据，预览是视图。** 任何预览组件都必须能一键回到源码。
2. **渲染进程不读盘。** 文件路径只在主进程解析；渲染层传相对路径、查询和内容。
3. **每次保存都先写临时文件、`fsync`、再原子替换。** 冲突时拒绝覆盖，保留双方内容。
4. **未保存内容必须有恢复快照。** 崩溃恢复不是“以后再说”的附属功能。
5. **外部副作用必须显式。** 外链只允许 http/https；图片预览限制在文稿目录；搜索不写文件。
6. **所有边界都要有上限。** 文件大小、目录深度、结果数量、正则时间、导出图片预算。

## 3. 文件安全

### 3.1 读取

- 以字节读取，先判断大小（桌面端 20 MiB 上限），再判断 UTF-16/BOM、NUL 与非法编码。
- 编辑器拿到的是 LF 归一化、去 BOM 的文本，同时保留原始格式元数据（BOM、LF/CRLF、混合行尾）。
- 文件版本使用 `mtimeMs + size + SHA-256`，保存前重新计算并与打开时比较。
- 不跟随符号链接；工作区读取前重新 `realpath` 并做目录包含检查。

### 3.2 写入

核心顺序只有一条：

```text
检查版本/冲突
  → 在目标同目录创建独占临时文件（wx, 0600）
  → 写入 → fsync → close
  → rename 覆盖目标
  → 任一步失败：删除临时文件，原文件不动
```

不要先截断目标文件再写。不要用普通 `writeFile` 直写用户文稿。失败注入测试覆盖 ENOSPC/EIO/EACCES、sync/close/rename 失败与临时文件清理。

`Save As` 是显式覆盖目标：不需要旧版本；普通保存必须带版本并与磁盘当前版本一致。

### 3.3 冲突与外部修改

- 外部程序改写文件后，保存被拒绝，编辑器内容保留。
- 用户可以选择“载入磁盘版本”或“另存为”；不允许后写者静默覆盖。
- watcher 使用 `fs.watch` + 轮询补充；自写事件通过路径与时间窗口忽略，最终用 SHA-256 确认。
- 删除/移动也要提示；不能把磁盘消失当成“保存成功”。

### 3.4 恢复快照

- 输入停止约 2.2 秒或持续编辑 15 秒写入；保存在 `app.getPath('userData')`，最多 20 份。
- 快照 ID：有路径用 SHA-256，无路径用 `untitled-<uuid>`。
- 快照写入同样原子；恢复后仍是“未保存”，需要用户主动保存。
- **切换文稿要清理旧快照。** 使用 save epoch 让在途快照失效，并丢弃被替换路径/ID 的旧快照；否则用户确认丢弃后，恢复横幅会在下一次打开时再次出现。
- 强杀、恢复、另存为、丢弃都有真实窗口证据；断电与真实满盘仍未验证。

### 3.5 导出

- 隐藏 `BrowserWindow` + `printToPDF` 生成 A4 PDF；HTML 由同一个清洗后的渲染链路生成。
- 本地图片只接受文稿目录内的光栅格式，经 `realpath` 包含检查，转 data URI；单图 8 MiB、总预算 24 MiB。
- 导出先写临时文件再替换，失败不留下半个文件。
- PDF 回读验证不能用 `pdftotext` 单独判断中文：它会漏 CJK；用 `pdfjs-dist` 提取文本并渲染页面。headless Chrome 直接 PDF 截图可能空白，不能当作导出失败的唯一依据。

### 3.6 工作区

- 打开文件夹后最多列 2000 个文稿、深度 8；跳过隐藏项、`node_modules`、`out`、`dist`、`release`、`coverage` 与符号链接。
- 渲染层只发送 POSIX 风格相对路径；主进程 `resolve` + `realpath` + 包含检查 + 普通文件检查。
- **Windows 8.3 短路径坑：** 临时目录可能返回 `RUNNER~1`，`realpath` 返回 `runneradmin`。必须先对根做 `realpath`，再比较候选路径，否则合法文件会被误判为链接逃逸。单元测试的临时根也要先 `realpath`。
- 侧栏切换脏文稿前确认；确认后清理被替换文稿的恢复快照。

### 3.7 搜索

单文件查找使用 CodeMirror `search()`；跨文稿搜索使用独立工具进程：

- 字面量先转义，再与正则共用 `RegExp`；默认大小写不敏感，始终带 `g`/`u`，逐行匹配；零长度匹配主动推进 `lastIndex`。
- 预算：查询 200 字符、结果 200 条、单文件 2 MiB、总量 64 MiB、每行 3 条；前 8 KiB 含 NUL 视为二进制。
- 每个文件读取前重新 `resolveWorkspaceFile`；渲染层只拿相对路径、行、列、预览。
- 结果点击通过当前工作区文件表找回文件，再走 `workspace:openFile`；编辑器 `revealLine(line,column)` 用 transaction 设置光标并滚动。
- 8 秒超时由主进程计时；超时/取消调用 `child.kill()`。**必须监听 `error`、`exit`、`spawn`、`message` 四个事件。** 未监听的 `UtilityProcess` `error` 会让主进程退出，这是本仓库实际踩过的坑。

## 4. Electron 安全与跨进程

- `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。
- preload 只暴露具名 API，不透传 `ipcRenderer`、`fs`、路径拼接。
- 生产 `file://` 响应注入 CSP；阻止新窗口和跨页导航；外部链接只允许 http/https，拒绝凭据与危险协议。
- IPC 参数必须在主进程解析和限制：文件版本、导出请求、恢复载荷、搜索开关都要验证；错误消息去掉 Electron IPC 前缀。
- 单实例锁避免两个进程写同一文稿；第二次启动只聚焦已有窗口。
- 工具进程模板：

```ts
const child = utilityProcess.fork(join(__dirname, 'worker.js'));
child.on('message', onResult);   // worker → main
child.on('error', onFailure);    // 必须监听，否则未处理 error 会冒泡
child.on('exit', onExit);        // 超时/崩溃/取消
child.on('spawn', () => child.postMessage(request));
const timer = setTimeout(() => child.kill(), 8000);
```

- 取消旧请求时先终止旧进程，再用请求 token 丢弃迟到结果；UI 只应用当前 token 的结果。
- Windows staging 目录包已验证真实窗口；Linux staging、asar 安装包中的 worker 路径与 dev server 尚未单独验证，不要写成“全平台已通过”。

## 5. CodeMirror 6 实践

- **源码是唯一文档。** 标题、引用、表格、图片、代码块都通过 Decoration / widget 呈现；不要另建 HTML 文档当编辑器。
- **Block widget 必须由 `StateField` 提供。** `ViewPlugin` 不能提供 block decoration；表格预览踩过这个限制。
- 外部打开文件时通过 `documentVersion` 重置 history；刷新外部内容不能污染撤销栈；格式命令保持单事务。
- 实时预览通过 Compartment 动态启停；预览回调通过 ref 读取最新值，避免反复重建扩展。
- 图片预览：CSS `display:none` + `loading="lazy"` 会导致图片永不加载；改为 eager，并在可见时再显示。
- 搜索面板：
  - 安装 `search({ top: true })`；只保留 `searchKeymap` 没有面板状态。
  - 用 `EditorState.phrases.of` 覆盖中文文案，不 fork 搜索包。
  - `openSearchPanel(view)` 会聚焦搜索框；之后不要再 `view.focus()`，否则焦点被抢回编辑器。
  - `Ctrl/Cmd+H` 打开面板后聚焦/选中替换框；替换全部走 CodeMirror transaction，原生 Undo 恢复。
- `revealLine` 模板：

```ts
const info = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines));
const position = info.from + Math.min(Math.max(0, column - 1), info.length);
view.dispatch({
  selection: { anchor: position },
  effects: EditorView.scrollIntoView(position, { y: 'center' }),
});
view.focus();
```

- 性能保护：超大文稿/超大表格退回源码是设计边界，不是“完整虚拟化”。

## 6. 测试策略

### 6.1 运行环境

本地系统 Node 20 无法加载 `sanitize-html` 的 ESM 依赖链，Vitest 报告器也可能缺 `Map.groupBy`。本地用 Electron 内置 Node：

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe \
  ./node_modules/vitest/vitest.mjs run
```

CI 使用 Node 24；本地结果与 CI 结果分开记录。

### 6.2 真实临时目录

- 文件 I/O、恢复、watcher、工作区测试必须用真实临时目录，不用 mock 文件系统。
- 临时根先 `realpath`，避免 Windows 8.3 短路径误判。
- POSIX 只读目录测试在 Windows 标记 skip；不要为了“全绿”伪造通过。
- 故障注入通过可替换的 `AtomicWriterOps` 完成，测试临时文件清理与原文件保留。
- 已知测试总数见 VERIFICATION；新增测试要同步更新 README、VERIFICATION、ROADMAP 与站点文案。

### 6.3 单元测试覆盖什么

适合：文本格式、GFM 清洗、路径边界、错误映射、搜索匹配/预算、导出图片解析、恢复快照原子写。

不适合：真实 Electron 窗口、原生文件对话框、系统浏览器、PDF 打印、输入法、焦点与滚动。这些必须用 staging + CDP/真实窗口另行验证。

## 7. 真实窗口 QA

### 7.1 构建与启动

```bash
npm run stage -w @gather/desktop
# 启动 release/win-unpacked/Gather.exe
# 需要 DevTools 协议时增加 --remote-debugging-port=9333
```

staging 是未签名冒烟包，不是发布物。截图与验收必须来自当前构建。

### 7.2 CDP 断言

- 用 `Page.captureScreenshot` 获取无窗口装饰的真实画面；用 DOM 查询断言命中数、active line、文件列表、overflow。
- 视口测试用 `Emulation.setDeviceMetricsOverride`；`--window-size=390` 的浏览器最小布局宽度约 500，不能作为 390 证据。
- 站点截图懒加载可能被快速滚动合并掉；逐张 `scrollIntoView` 后再等 `complete && naturalWidth > 0`。
- 页面完整性与部署产物用 SHA-256 对比，不以“看起来一样”作为结论。

### 7.3 原生对话框

- 优先使用 Windows UI Automation 的元素索引，而不是截图坐标；DPI、窗口缩放和截图尺寸变化会让坐标落到别处。
- 文件选择器可以先输入完整路径，再点击“选择文件夹”；每次操作后重新观察窗口状态。
- 这是测试工具经验，不是产品路径；不要把自动化脚本或真实用户路径写进仓库。

### 7.4 验收证据

一次 UI 验收至少包含：

1. 构建类型与启动方式。
2. 真实操作步骤（键盘/鼠标）。
3. DOM/状态断言（数量、行号、光标位置、保存状态）。
4. 失败路径（超时、非法输入、取消）。
5. 截图或文字日志。
6. 边界与未测项。
7. 应用是否继续存活（尤其是工具进程/正则/崩溃场景）。

合成文稿放在 `C:\Users\Public\...` 等公开目录，验收后删除；公开截图不含真实用户文件、账户 ID 或凭据。

## 8. CI、PR 与发布闭环

### 8.1 为什么用 Git Data API

本仓库经历了直接 `git push` 的 TLS reset。稳定的回写方式是：

```text
GET  main ref / commit
POST blobs（本地内容 → base64，校验 Git blob SHA）
POST tree（base_tree = main tree）
POST commit（parent = main）
POST ref（新分支）
POST pull request
```

要点：

- 提交前比较远程 main SHA，拒绝在移动后的基线上盲写。
- 只提交预期文件；提交后回读 tree/PR 文件列表与本地 blob SHA。
- 分支 + PR，不直推 main；CI 绿后合并。
- 不在日志、提交或 PR 中出现 token；使用本机 `gh` keyring。
- 文档 PR 与代码 PR 分开：代码先合并、Pages 部署，再用独立文档 PR 记录运行号与公网哈希。

### 8.2 Pages

- build 与 deploy 拆成两个 job，避免 artifact 竞态；构建成功不等于部署成功。
- 部署后用 `curl` + `Cache-Control: no-cache` 取公网文件，SHA-256 与本地 `dist` 比较。
- 页面在 1440 与 390 视口检查 `scrollWidth = clientWidth`，产品截图 naturalWidth 非零。
- 站点/锁文件变化才触发 Pages；纯文档 PR 通常不触发。

### 8.3 批次索引

| 批次 | PR / 合并 | CI | Pages | 主要经验 |
| --- | --- | --- | --- | --- |
| 导出管线 | #12 / `b237716` | 44918269575 | 44918269622 | A4 PDF、图片 data URI、先临时文件再替换 |
| 预览与安全外链 | #14 / `4e0c1e9` | 44981317065 | 44981317068 | Block widget 必须 StateField；图片 eager；外链协议白名单 |
| 文件夹工作区 | #16 / `a874667` | 44983351330 | 44983351367 | 2000 文件/深度 8；realpath；8.3 短路径；脏状态确认 |
| 单文件搜索 | #18 / `a4c63f2` | 44985572444 | 44985572472 | search() 状态；中文 phrases；打开面板不要抢焦点 |
| 工作区搜索 | #20 / `a6b51e1` | 45102037935 | 45102037910 | utilityProcess；预算/超时；error 监听；定位等待文稿版本 |
| 部署记录 | #21 / `b871d4c` | 45102465517 | — | 把运行号、哈希与边界写回仓库 |

### 8.4 关键故障索引

完整细节见 [DEBUG_LOG](DEBUG_LOG.md)。这张表只帮助定位：

| 编号 | 主题 | 关键教训 |
| --- | --- | --- |
| P1-21 | 站点滚动、懒加载与移动端 | 懒加载图片需要真实进入视口；390 用设备模拟而不是窗口尺寸 |
| P1-22 | 项目展示仍停留在 Phase 0 | 展示内容必须跟当前构建同步，不能把计划写成已完成 |
| P1-23 | Pages 同 job 上传/部署竞态 | build 与 deploy 拆 job，artifact 名称固定 |
| P1-24 | 导出本地图片与原子写 | 图片目录边界、data URI 预算、目标文件失败清理 |
| P1-25 | PDF 验证误判 | `pdftotext` 漏 CJK；headless PDF 截图可能空白；用 pdfjs |
| P1-26 | 导出卡片撑宽窄屏 | 图片固有宽度需要 `min-width:0` 与固定预览高度 |
| P1-27 | 表格/图片预览与链接 | block decoration 用 StateField；lazy + hidden 不加载；外链白名单 |
| P1-28 | 工作区路径与快捷键 | 根先 `realpath`；8.3 短路径；`Ctrl+Shift+O` 显式检查 Shift |
| P1-29 | 单文件搜索状态 | 只装 keymap 没有面板；打开面板后不要抢搜索框焦点 |
| P1-30 | 工作区搜索进程 | 必须监听 `UtilityProcess` error；定位等待文稿版本提交 |

## 9. Windows / Linux 平台笔记

- Windows 临时目录可能是 8.3 短路径；用 `realpath` 归一化后再做包含检查。
- 仓库文本统一 LF；本地文件可能是 CRLF/BOM，保存策略必须显式。
- Windows 只读目录/权限行为与 POSIX 不同；POSIX 测试在 Windows skip，不能假装通过。
- headless Chrome/Edge 的最小布局宽度约 500；真实 390 用 CDP 设备模拟。
- 原生文件对话框的元素树比坐标稳定；截图坐标可能受 DPI 影响。
- 文件系统 watcher 在 Windows 上可能有延迟/重复事件；最终用 SHA-256 确认。
- Linux GUI、Fcitx5/IBus、X11/Wayland、AppImage/deb 尚未实际运行，不要写“Linux 已验证”。
- `asar` 中 worker 路径、签名与自动更新仍未验证。

## 10. 边界登记

### 已验证

- 打开/保存/另存、CRLF/BOM 字节保真、20 MiB 上限、冲突拒绝、原子写入故障注入。
- 恢复快照、强杀恢复、外部修改/删除提示、载入磁盘版本。
- A4 PDF 与含本地图片 HTML 导出，真实回读。
- GFM 表格/本地图片预览、安全外链。
- 文件夹工作区、侧栏切换、脏文稿确认、工作区搜索与超时。
- Windows staging 启动与真实窗口路径；GitHub Pages 部署与哈希回读。

### 未验证

- Windows/Linux IME 矩阵、Linux 图形会话、200% 缩放、屏幕阅读器、全键盘可达性。
- 真实断电/满盘/只读挂载、8 小时 dogfood、5 MiB 文稿性能基线。
- asar 安装包中的工具进程、dev server 下的 worker、Linux worker。
- 干净 VM 安装/卸载、签名、自动更新、回滚。

### 未实现

- 最近工作区持久化、树形折叠、新建/重命名/删除文件。
- 跨文稿替换、搜索历史、包含/排除规则、流式结果。
- DOCX、CLI PDF、图片缩放/平移、EXIF 方向。
- AI/Ollama/BYOK/diff 审阅/RAG、云同步、多人协作。
- NSIS/portable/AppImage/deb 发布物、Tauri bake-off。

### 不要声称

- “生产级安全安装包”已有。
- “AI 已经能自动改稿”已有。
- “所有平台稳定”已验证。
- “CI 绿”等于“GUI/IME/打印/文件对话框已通过”。
- “看起来像”等于“截图真实”或“公网哈希一致”。

## 11. 检查清单

### 新功能

1. 它改变了哪条不变量？是否引入第二份文档模型？
2. 数据从哪来、经过哪些进程、在哪个边界验证？
3. 失败时的用户可见行为是什么？能否恢复？
4. 文件/网络/正则/内存/结果数量的上限是什么？
5. 渲染层是否需要新 IPC？preload 是否最小？
6. 纯逻辑是否有单元测试？界面是否需要真实窗口验收？
7. 是否影响撤销、恢复、冲突、工作区路径？
8. 是否需要 ADR？是否需要更新 README/VERIFICATION/ROADMAP？
9. 是否有可复用的经验应写入本手册？
10. CI 双平台、构建、Pages 与公网哈希是否闭环？未测项是否写明？

### Bug 修复

1. 用最小步骤复现，记录现象与环境。
2. 先定位根因；不要只改表现。
3. 收窄修复范围，避免顺带重构。
4. 能写回归测试就写；不能写的说明原因。
5. UI/文件/进程问题做真实窗口复测。
6. 在 DEBUG_LOG 追加 P1：现象、根因、修复、证据、防回归。
7. 更新 VERIFICATION 矩阵与测试数（如变化）。
8. 检查应用是否继续存活，而不只是“错误消失”。

### 发布 / 部署

1. 远程 main 是否仍然等于预期基线？
2. 分支只包含预期文件？回读 blob/PR 文件列表。
3. CI 双平台是否全绿？测试数是否与文档一致？
4. 构建是否包含新的 main/preload/renderer/worker 产物？
5. 合并后 main CI 与 Pages 是否完成？
6. 公网 HTML/CSS/图片 SHA-256 是否与本地一致？
7. 1440/390 是否无横向溢出？截图是否全部加载？
8. 文档 PR 是否记录本次运行号、哈希与边界？
9. QA 合成目录、临时脚本、浏览器 profile 是否清理？
10. 回滚 commit / 撤销路径是否写明？

### 安全审查

1. 渲染层是否仍无 Node/`fs`/绝对路径？
2. 外链是否只放行 http/https？是否拒绝凭据与危险协议？
3. 文件路径是否经过根 `realpath` + 包含 + 普通文件检查？
4. 图片预览/导出是否限制扩展名、大小、总预算与目录？
5. CSP、导航、新窗口、单实例是否仍有效？
6. 正则/大文件是否在隔离进程并有限时？
7. 日志、PR、截图是否含 token、用户文稿、账户 ID 或私有路径？
8. 失败注入是否覆盖 ENOSPC/EIO/EACCES、sync/rename 失败？

## 12. 学习路径与术语

### 建议的源码练习

1. 读 `packages/core/src/text-format.ts`，写出 LF/CRLF/BOM 的测试。
2. 读 `apps/desktop/src/main/atomic-write.ts`，为 rename 失败补一个断言。
3. 读 `apps/desktop/src/main/workspace.ts`，解释为什么根要先 `realpath`。
4. 读 `packages/editor/src/live-preview.ts`，找到表格 StateField 与图片 widget。
5. 读 `apps/desktop/src/main/workspace-search.ts`，修改预算并补测试。
6. 用 staging 打开一个合成工作区，执行一次真实搜索、超时与点击跳转。
7. 按第 8 节流程发一个只改文档的 PR，验证 CI 与合并状态。

### 术语

- **Source truth**：唯一可编辑的数据源；本项目中是 Markdown 文本。
- **Decoration**：CodeMirror 的显示层效果，不改变文档内容。
- **StateField**：随 EditorState 存储与更新的扩展；block widget 依赖它。
- **Utility process**：Electron 子进程，用于隔离 Node 扫描/正则。
- **Atomic write**：临时文件 + fsync + rename，避免半写文件。
- **Recovery snapshot**：未保存内容的崩溃恢复副本，不是自动保存覆盖磁盘。
- **BYOK**：Bring Your Own Key；用户自带模型凭据，未来 AI 阶段。
- **Conflict digest**：用 SHA-256/尺寸/时间识别外部修改。

## 13. 下一步与风险

优先候选：

1. 最近工作区/最近文件跨重启恢复（需要处理根目录消失、恢复快照与启动状态）。
2. 工作区树形折叠、新建/重命名/删除（需要明确确认、回收站与路径边界）。
3. 搜索历史、包含/排除规则、跨文稿替换的审阅边界。
4. IME 真机矩阵、200% 缩放/屏幕阅读器、5 MiB/10 万字符性能基线。
5. 安装包签名、自动更新、干净 VM 安装/卸载；Linux 图形会话。
6. CLI PDF/DOCX、本地 AI/Ollama/BYOK/diff 审阅/RAG；Tauri bake-off。

主要风险：

- 跨平台 GUI 与 IME 没有自动化，CI 绿不能替代真机。
- `utilityProcess`/asar/Linux 路径仍有未验证面。
- 搜索/替换与大文件性能缺少长期基线。
- 恢复快照未加密，依赖操作系统账户权限。
- 安装包、签名、自动更新与商标/域名尚未清障。

每一次新批次都应把新的失败、边界与验证方式写回 [DEBUG_LOG](DEBUG_LOG.md)、[VERIFICATION](VERIFICATION.md) 与本手册，而不是只留在对话或 PR 里。
