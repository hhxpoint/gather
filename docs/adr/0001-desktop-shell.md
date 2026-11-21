# ADR 0001：Phase 0 桌面壳选择 Electron

- 状态：Accepted（Phase 0）
- 日期：2026-11-21
- 决策者：Gather maintainers
- 相关：ADR 0002（编辑器核心）

## 背景

Gather 是本地优先的 Markdown 写作工作台，首发计划覆盖：

- Windows 10/11；
- Linux：Ubuntu/Debian、Fedora，X11 与 Wayland；
- 一等公民 CLI：`gather doctor/export/new` 必须能脱离桌面应用运行；
- 中文输入法是核心使用场景，不是边缘兼容项；
- 后续需要 HTML、PDF、DOCX 导出，PDF 要保留 CJK 字体、代码块、表格、图片与分页；
- AI 修改要进入逐块 diff 审阅，桌面端需要稳定的文本编辑与文件写入。

Phase 0 需要尽快得到一个可运行、可调试、可打包的桌面骨架，同时不能把未来的编辑器核心和 CLI 锁死在某个壳里。候选主要是 Electron 与 Tauri 2；Tauri 2 的安装包更小、内存更低，但 Linux 使用系统 WebKitGTK，中文 IME 与打印/PDF 的跨发行版一致性需要实测。

## 决策

Phase 0 使用 **Electron 38 + electron-vite 4 + React 19**，用 electron-builder 管理 Windows/Linux 打包目标。

具体落地：

- `apps/desktop/src/main`：窗口、菜单、文件对话框、文件读写、IPC、单实例。
- `apps/desktop/src/preload`：只暴露 `openFile`、`saveFile`、`saveFileAs`、`onMenuAction`。
- `apps/desktop/src/renderer`：React UI + `@gather/editor`。
- `packages/core`、`packages/editor`、`packages/cli` 不依赖 Electron。
- 打包目标：Windows `nsis`/`portable`；Linux `AppImage`/`deb`。

Tauri 2 不作为 Phase 0 的默认壳，但保留迁移路径。只有在四项硬门槛全部通过 bake-off 后，才允许切换。

## 决策驱动因素

按优先级排序：

1. **中文输入法可靠性。** 写作工具丢字、重复上屏、候选框错位都是阻断级问题。
2. **Linux 一致性。** 同一份编辑体验要在不同发行版、X11/Wayland、GTK 主题下成立。
3. **PDF 导出保真。** CJK 字体、代码、表格、图片、分页不能靠“用户自己装字体”。
4. **CLI 与核心共享。** CLI 不能依赖桌面运行时，也不能复制一套 Markdown 逻辑。
5. **开发速度与可调试性。** 小团队需要成熟的 DevTools、崩溃日志、打包工具。
6. **安全更新节奏。** 桌面应用要能跟上 Chromium/WebKit 的安全修复。
7. **安装包体积与内存。** 重要，但排在前四项之后。

## 选择 Electron 的理由

### 一致的 Chromium

Windows 与 Linux 都使用同一套 Chromium 渲染引擎，不依赖发行版自带的 WebKitGTK 版本。CodeMirror 的选区、组合输入、字体度量、打印行为更容易复现。对“中文 IME + 实时预览装饰”这种组合，减少一个系统 WebView 变量很重要。

### 主进程直接使用 Node

文件对话框、UTF-8 读写、临时文件 + `rename`、单实例锁、菜单都可以用 Node/Electron API 完成。CLI 与桌面端共享 TypeScript 核心，不需要通过 Rust 命令桥接文件系统。

### 成熟的工具链

electron-vite 提供 main/preload/renderer 三端构建与 HMR；electron-builder 覆盖 Windows NSIS/portable 与 Linux AppImage/deb；DevTools 与崩溃日志链路成熟。Phase 0 的时间应该花在编辑器与文件安全上，而不是先造一套壳工具链。

### 风险可控

Electron 的代价是明确的：安装包大、内存高、Chromium CVE 需要持续跟进。这些是运营成本，不是架构不确定性。相比之下，Tauri 2 在 Linux WebKitGTK 上的 IME/打印行为存在版本与发行版差异，属于产品阻断风险，必须先用实验消除。

## 代价与约束

- **体积**：Electron 安装包通常是几十到上百 MB 量级；AppImage 更大。需要接受首版下载成本。
- **内存**：多进程模型带来固定开销；不能用“比原生编辑器更轻”作为卖点。
- **安全更新**：必须跟踪 Electron 与 Chromium 的安全版本，不能长期钉在旧 major。
- **签名**：Windows 需要 Authenticode 证书与密钥管理；Linux 需要 GPG 签名与仓库维护。详见 README 的分发成本一节。
- **无系统 WebView 复用**：不能依赖用户系统已有的 WebView 来减小体积。
- **壳泄漏风险**：一旦在 `core`/`editor` 里引用 Electron API，Tauri 迁移就会变成重写。必须用代码审查守住分层。

### 强制架构约束

为保证未来可迁移，Phase 0 起执行：

- `packages/core` 不导入 `electron`、`node:fs`、DOM、React。
- `packages/editor` 不导入 `electron`、`node:*`；只依赖 CodeMirror、React 与 `core`。
- 文件系统、对话框、菜单、窗口生命周期只出现在 `apps/desktop/main`。
- `preload` 只暴露业务级方法，不暴露通用 IPC、`fs`、`child_process`。
- CLI 只依赖 `core` 与 Node 标准库，不依赖 Electron。
- Markdown 渲染、计数、导出模板放 `core`，桌面端与 CLI 共用。

## Tauri 2 候选与硬门槛

Tauri 2 的优势是安装包小、内存低、系统 WebView 复用、Rust 侧权限模型清晰。它的问题也集中在我们最不能出错的地方：Linux WebKitGTK、中文 IME、打印/PDF、以及 CLI 与前端核心的共享方式。

以下四项是 **AND** 关系，不是打分项。任何一项失败，Phase 0–3 继续使用 Electron。

### G1：Linux WebKitGTK 兼容性

测试矩阵至少包含：

- Ubuntu 22.04、Ubuntu 24.04、Debian 12、Fedora 当前稳定版；
- X11 与 Wayland 各一轮；
- 不同 GTK 主题、深色/浅色、100%/200% 缩放；
- 打开 1 MiB / 5 MiB Markdown，滚动、搜索、预览开关；
- 文件对话框、拖放、剪贴板、外部链接、打印预览；
- 字体回退：思源宋体/黑体、Noto CJK、系统缺失中文字体时的降级。

通过标准：无崩溃、无空白窗口、无输入丢失、无字体缺字导致的布局破坏；与 Electron 基线相比，关键交互没有不可接受的延迟。出现“某些发行版必须降级 WebKitGTK 才能用”的情况视为失败。

### G2：中文输入法

测试矩阵至少包含：

- Windows 10/11：微软拼音、搜狗拼音；
- Linux：Fcitx5、IBus，配合拼音输入法；
- 组合输入期间的预编辑文本、候选框定位、标点、emoji、长按重复、撤销；
- 实时预览装饰开启/关闭、光标所在行显示语法标记、跨行选择；
- 快速输入、退格、Esc 取消、焦点切换。

通过标准：不丢字、不重复上屏、组合期间预览不抖动、撤销粒度合理、候选框跟随光标。任何“偶发丢字”都视为失败，因为写作工具无法用“重启试试”解释。

### G3：PDF 导出

用同一组 fixture 对比 Electron 基线：

- 中文正文、标题、引用、列表、表格、代码块、行内代码、图片、链接；
- 字体嵌入/子集化、缺字回退、页码、分页、页边距；
- 长表格跨页、代码块跨页、图片缩放；
- 打印背景/颜色、链接注解（如支持）。

通过标准：输出无缺字、无截断、无错位；与基线视觉差异在可解释范围内；不要求用户安装额外字体；同一输入多次导出结果稳定。WebKitGTK 的打印路径如果依赖系统打印服务或出现字体替换，视为失败。

### G4：CLI 共享核心

- `@gather/core` 必须能在纯 Node 24 环境运行，不引入 DOM、Electron、Tauri 运行时。
- CLI 构建产物不依赖桌面壳；`gather doctor/export/new` 在无 GUI 的 Linux 容器中可运行。
- 桌面端与 CLI 使用同一份 Markdown 渲染、计数、HTML 模板。
- 如果 Tauri 需要把核心编译为 Rust 或通过 sidecar 运行，必须证明版本一致、发布体积可接受、错误处理可追踪。

通过标准：CLI 在 Windows 与 Linux 的干净 Node 24 环境通过同一组测试；不出现“桌面端渲染结果与 CLI 导出结果不同”。

## Bake-off 协议

目的不是做一个完整 Tauri 版，而是用最小实验回答四个问题。

### 范围

- 一个 Tauri 2 spike 分支/目录，不合并进主线，直到决策完成。
- 复用 `@gather/core` 与 `@gather/editor`，只重写壳层：窗口、文件对话框、文件读写、菜单、打印/PDF。
- 实现打开、保存、另存、实时预览开关、导出 HTML、导出 PDF 的最小路径。
- CLI 直接复用现有 `packages/cli`，不复制命令实现。

### 流程

1. 固定 fixture 集与机器矩阵（Windows 11 一台、Ubuntu 24.04 一台、Fedora 一台；X11/Wayland 可双启动）。
2. 先跑 Electron 基线，记录启动时间、内存、输入延迟、PDF 输出、IME 结果。
3. 跑 Tauri 2 spike，同机同 fixture，记录同样指标。
4. 每项硬门槛给出 Pass/Fail 与证据（录屏、日志、PDF、性能数字）。
5. 安全审查：Tauri capabilities、allowlist、IPC 命令、外部链接、文件系统权限。
6. 输出决策记录：更新本 ADR 或新增 ADR，明确“切换/不切换”和理由。
7. 如果不切换，保留 spike 结论与复现步骤，下一次评估不重复踩坑。

### 时间盒

建议 2 周（一人）到 3 周（包含 Linux 矩阵与 PDF 对比）。超过时间盒仍无法回答 G1/G2，按 Fail 处理，不无限延长。

## 迁移条件

即使四项硬门槛全部通过，迁移仍需满足：

- **可量化收益**：安装包体积或空闲内存有显著下降（建议至少 40%，最终阈值在 bake-off 后定），启动与输入延迟不退化。
- **无编辑回归**：IME、撤销、搜索、预览、文件打开/保存在 4 周 dogfood 中无 P0 问题。
- **打包与签名可行**：Windows 签名、Linux 分发、自动更新方案可落地，成本可接受。
- **团队容量**：有人负责 Rust/Tauri 壳的长期维护与安全更新；不能把迁移留给“以后”。
- **回滚方案**：Electron 版本在迁移期保持可构建；数据格式不变，用户文稿不需要迁移。
- **安全审查通过**：权限最小化、IPC 校验、外部内容隔离、依赖审计。
- **CLI 不受影响**：核心仍可在纯 Node 运行，发布流程不分裂。

迁移只重写壳层，不重写编辑器与核心。如果发现需要改 `packages/core` 才能适配 Tauri，先暂停并重新评估，因为这说明分层已经被破坏。

## 不迁移的条件

出现以下任一情况，继续 Electron，并在下一个 major 周期再评估：

- G1–G4 任一 Fail；
- Linux 上需要用户手动调整 WebKitGTK/输入法环境才能正常写作；
- PDF 导出依赖系统字体或打印服务，无法保证一致；
- CLI 需要 sidecar 或重复实现；
- 打包/签名/更新成本高于节省的体积与内存收益；
- 团队没有长期维护 Rust 壳的 capacity。

“Tauri 更现代”“安装包更小”不是迁移理由；只有四项硬门槛与迁移条件同时成立才是。

## 后果

### 正面

- Phase 0 可以用成熟工具快速得到可运行骨架。
- Windows/Linux 的 Chromium 行为一致，IME 与 PDF 基线更可控。
- CLI 与桌面端共享 TypeScript 核心，测试与发布路径简单。
- 未来若切换 Tauri，核心与编辑器不需要重写。

### 负面

- 安装包与内存成本高，需要持续更新 Electron。
- 需要 Windows 代码签名预算与 Linux 分发维护。
- 团队必须抵抗“在 core 里直接用 Electron API”的捷径。

### 中性

- Electron 38 是 Phase 0 的锁定主版本；升级 major 需要单独验证 IME、PDF、Linux 打包。
- Tauri 2 继续作为候选，但不是路线图承诺；没有通过 bake-off 前，不在官网/README 宣称“将迁移到 Tauri”。

## 参考

- Electron 安全清单与进程模型（官方文档）。
- Tauri 2 capabilities / WebView 文档。
- WebKitGTK 发行版差异与 IME 相关 issue。
- ADR 0002：编辑器核心选择 CodeMirror 6。
- `apps/desktop/package.json`：当前 electron/electron-vite/electron-builder 版本与打包目标。
- `apps/desktop/src/main/index.ts`：当前窗口、IPC、原子写入实现。
