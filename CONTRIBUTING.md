# Contributing to Gather

Gather 已进入 Phase 1 文件可靠性阶段。当前目标是让桌面壳、编辑器、CLI、共享核心、官网、测试与 CI 成为一个可重复运行的闭环，并把“不丢稿”从口号变成可验证机制；不是堆功能，也不是先做发布会。提交之前请先接受两个前提：

1. **Markdown 文件是唯一真相。** 任何会让文稿在用户不知情时改变字节、结构或位置的设计，都需要单独讨论。
2. **AI 修改必须可审阅。** 不存在“自动帮用户改完”的快捷键。模型输出只能进入 diff，逐块接受或拒绝后才落盘。

## 当前阶段可以贡献什么

- Windows 10/11 与 Linux（Ubuntu/Debian/Fedora，X11/Wayland）上的真实运行与输入法测试。
- Markdown 保真 corpus：frontmatter、表格、HTML 块、CJK、emoji、超长行、混合行尾策略。
- 编辑器纯函数、文件 I/O 与渲染清洗的测试。
- Electron 安全加固：依赖审计、自动更新校验、文件 watcher 权限边界。
- 自动保存、崩溃恢复与备份策略的设计和故障注入测试。
- 官网内容与 GitHub Pages 工作流。
- 文档纠错：命令必须与仓库脚本一致，不能写不存在的 `npm run`。

Phase 0 不接受：RAG、云同步、多人协作、内置付费模型、自动改稿、遥测/分析 SDK。这些不是“以后加个开关”就能解决的问题，先把文件安全和编辑可靠性做完。

## 环境准备

- Node.js **24.x**（`.nvmrc` 为 `24`；`engines` 允许 `>=22.13.0`，但开发与 CI 以 24 为准）。
- npm（使用 npm workspaces）。
- Windows 10/11 或带桌面环境的 Linux；Linux 需要 Electron 的 GTK3/NSS/ALSA 等运行库。
- Phase 0 不需要 Rust、Python、Tauri。

```bash
nvm use 24        # 或 fnm use 24
npm install
npm run dev       # electron-vite dev
```

首次安装会下载 Electron。网络受限时配置镜像，不要把镜像地址或凭据写进仓库。

### 当前阶段的验证边界

先把边界说清楚，不要把 CI 绿当成发布结论：

- `npm run build` 已在干净 Ubuntu 与 Windows CI runner 上通过，三个 workspace 产物均能生成。
- `npm test` 当前包含 core、editor、桌面文件 I/O、恢复快照、watcher、原子写入故障注入与错误映射，共 8 个测试文件、63 个测试；本地与 CI 双平台均已通过（故障注入批次运行 44886639093）。
- `npm ci` 已在双平台 CI 运行成功；仓库锁文件有效。
- `.github/workflows/ci.yml` 覆盖 `ubuntu-latest` 与 `windows-latest`；故障注入批次运行 44886639093 全绿，上一批基线为 44885022294。
- CI 不启动图形桌面、不测真实文件对话框、不覆盖 IME、打印或安装包。Windows 上的打开/另存为/预览切换/CRLF-BOM 保存/冲突拒绝/快照恢复/外部变更提示/20 MiB 拒绝已手工验证；Linux 桌面与会话级验证仍未做。
- 系统 Node 20 无法加载 `sanitize-html` 的 ESM 依赖链；本地请用 Node 22/24，或使用 Electron 内置 Node 运行 Vitest。

需要单独构建时：

```bash
npm run build -w @gather/desktop
npm run build -w @gather/site
npm run build -w @gather/cli
```

如果你要提交“测试通过”，请同时给出实际执行的命令、Node 版本、操作系统和输出。没有执行就写“未验证”。

## 仓库结构

| 路径 | 职责 | 修改注意 |
| --- | --- | --- |
| `packages/core` | Markdown 渲染、HTML 模板、计数 | 纯 TypeScript；不得引入 Electron、DOM、React、文件系统 |
| `packages/editor` | CodeMirror 6 封装、预览装饰、文本命令 | 可以有 DOM/React；不得直接读文件或调用 Electron |
| `apps/desktop/main` | 窗口、菜单、文件对话框、file-io、IPC | 文件系统与权限只在这里；校验所有 IPC 入参；保存必须走 file-io 的原子写入与冲突检查 |
| `apps/desktop/preload` | 最小 contextBridge API | 不暴露 `fs`、`child_process`、任意 `ipcRenderer` |
| `apps/desktop/renderer` | UI、状态、编辑器挂载 | 不启用 Node；不加载远程脚本/字体 |
| `packages/cli` | `gather doctor/export/new` | 不依赖 Electron；与桌面端共享 `@gather/core` |
| `apps/site` | 官网静态骨架 | 已有 `index.html`、`styles.css`、`build.mjs`、`package.json`；已部署到 GitHub Pages；不要复制桌面端密钥或内部配置 |

跨层规则：

- 领域逻辑放 `core`，编辑行为放 `editor`，壳能力放 `desktop/main`。不要把文件路径、窗口对象或 Electron API 泄进核心。
- 新增 Markdown 行为时，先问“保存后字节是否改变”。会改变的功能必须显式、可撤销、可测试。
- 实时预览只能使用 CodeMirror 装饰，不得另建一份 HTML 文档作为编辑真相。
- CLI 与桌面端必须共用 `@gather/core`，不允许复制粘贴一套渲染逻辑。

## 开发规范

- TypeScript strict，ESM；沿用现有 2 空格、单引号、分号风格。仓库没有格式化脚本，不要顺手重排无关文件。
- 不引入默认遥测、分析、崩溃上报 SDK。崩溃报告如果以后做，必须默认关闭或明确征得同意，且不包含文稿内容。
- 新依赖需要说明：用途、许可证、体积、是否发起网络请求、是否与 AGPL-3.0 兼容。不接受内置付费 API 或需要账号的默认服务。
- UI 文案以中文为主，代码标识符用英文。新增用户可见文本时考虑中英文长度差异。
- 不提交 `node_modules/`、`dist/`、`out/`、`release/`、`.env`、真实用户文稿、密钥、签名证书。
- 大文件、二进制 fixture 要说明来源与许可证；优先使用可再生成的小 fixture。

## 测试

测试文件放在 `packages/**/test/**/*.test.ts` 与 `apps/desktop/test/**/*.test.ts`，由根 `vitest.config.ts` 匹配。当前有：

- `packages/core/test/markdown.test.ts`：GFM、HTML 清洗、链接/图片协议、文档模板、计数。
- `packages/core/test/text-format.test.ts`：LF/CRLF/BOM、混合行尾、无结尾换行、跨 IPC 格式校验。
- `packages/editor/test/text-commands.test.ts`：`toggleWrap`、`toggleLinePrefix`、`insertAroundSelection`。
- `apps/desktop/test/file-io.test.ts`：临时目录 round-trip、外部修改拒绝、文件删除拒绝、Save As、混合行尾归一。
- `apps/desktop/test/recovery.test.ts`：路径/未命名快照、覆盖、列表、读取、丢弃、损坏文件与路径 ID。
- `apps/desktop/test/file-watcher.test.ts`：外部修改、自写忽略、删除与重建、轮询差异。
- `apps/desktop/test/atomic-write.test.ts`：ENOSPC/EIO/EACCES、sync/close/rename 失败、临时文件清理与原子替换。
- `apps/desktop/test/file-errors.test.ts`：文件系统错误映射与 Electron IPC 前缀清理。

提交恢复/文件监视相关改动时，至少覆盖：

- 强杀后快照仍在、原文件未被改写；恢复后保存会清理快照。
- 打开另一个文件不会删除旧快照。
- 自身保存不会触发外部修改提示；外部修改只通知一次。
- 文件删除、移动、重建后的状态；未命名文稿恢复后另存为。
- 快照超过 20 份、损坏 JSON、无权限目录等边界。

提交编辑相关改动时，至少覆盖：

- 空选区、单行、多行、跨行选择、嵌套标记、选区边界。
- 连续执行两次格式命令是否回到原文（幂等/可逆）。
- CRLF、BOM、无结尾换行、CJK、emoji、组合字符。
- 表格、任务列表、代码围栏、frontmatter、原始 HTML 块在解析与导出中的行为。
- 打开新文件后撤销栈是否重置；预览开关是否影响光标与选区。

Markdown 保真测试优先做“字节级 round-trip”：读取 fixture，进入编辑器状态，再写出，比较字节。无法字节一致的场景必须写明规范化规则，并让用户可见。

### 手工测试矩阵

涉及桌面端、IME、文件对话框、预览装饰的改动，PR 中附上实际矩阵：

| 维度 | 至少覆盖 |
| --- | --- |
| Windows | Windows 10 或 11；微软拼音；可选搜狗 |
| Linux | Ubuntu 22.04/24.04 或 Fedora 当前稳定版；Fcitx5 或 IBus；X11 与 Wayland 至少各一次 |
| 输入 | 中文组合输入、标点、emoji、撤销、候选框定位、长按重复 |
| 文件 | 新建、打开、另存、只读目录、20 MiB 边界、CRLF 文件、无结尾换行 |
| 恢复/外部 | 编辑后强杀并重启、恢复路径/未命名快照、外部改写/删除/重建、载入磁盘版本、保存期间继续输入 |
| 失败路径 | ENOSPC/EACCES/只读、20 MiB 边界、保存目录消失；确认原文件与恢复快照保持不变 |
| 显示 | 100% 与 200% 缩放、窗口最小尺寸、长行折行 |

没有条件执行的平台写“未测试”，不要用“应该没问题”代替。

## 数据安全规则

- **不丢稿优先于一切。** 任何保存路径都必须先写临时文件、`fsync`、再原子替换；保存前比较打开时的 SHA-256/尺寸，外部修改时拒绝覆盖；失败时保留原文件。未保存内容必须进入恢复快照，不许只留在内存。
- **不做静默格式转换。** 编码、行尾、BOM、空行的改变必须是显式操作，或在文档中明确说明。当前混合行尾会在保存时统一为 LF，界面必须提示。
- 不在用户未确认时删除、移动、重命名文件；CLI `new` 使用 `wx` 拒绝覆盖，保持这个行为。
- 文件大小上限（桌面端 20 MiB）必须有清晰错误信息；提高上限需要性能和内存测试。
- 写入失败必须清理临时文件且不替换原文件；ENOSPC/EACCES/EROFS/EBUSY 等错误要映射为可操作提示，不能把 Electron IPC 前缀直接丢给用户。
- 处理外部文件变更时要提示冲突并保留双方内容；不允许后写者静默覆盖，也不允许自动重载丢掉编辑器内容。
- 恢复快照属于用户文稿数据：不得写日志、不得上传、不得提交进仓库；测试使用合成文本。
- 不引入云同步作为“顺手功能”。本地优先是架构约束，不是设置项。

## AI 与隐私规则

Phase 0 没有 AI 代码。后续实现必须遵守：

- 默认关闭、默认不联网、默认不上传。开启 AI 需要用户明确操作。
- 本地优先 Ollama；云端只允许用户自带 Key（BYOK），不内置付费 API、不代理计费。
- Key 存操作系统凭据库，不写明文配置、不进日志、不进仓库、不进崩溃报告。
- 发送内容可见、可裁剪；默认不发全文；不后台索引、不自动附带其他文稿。
- 模型返回只能是建议。必须展示 diff，逐块接受/拒绝，接受后才作为一次可撤销的文本事务写入。
- 不做自动改稿、不做“静默修复”、不在保存时调用模型。
- 不使用用户文稿训练模型；不把文稿用于分析、排名或产品改进。
- 测试使用 mock 或本地假服务，不提交真实 API Key，不访问真实付费端点。

审查 AI 相关 PR 时，第一个问题不是“效果好不好”，而是“默认情况下有没有数据离开设备”。

## Commit 与 PR

### Commit

使用 Conventional Commits 风格，一个提交只做一件事：

```text
feat(editor): reveal markdown marks on the active line
fix(desktop): reset undo history when opening a file
docs(adr): record electron shell decision
test(core): cover javascript: links in sanitizer
chore(ci): add node 24 windows and ubuntu matrix
```

要求：

- 标题说明“做了什么”，正文说明“为什么”和“怎么验证”。
- 不把格式化、重命名、功能改动混在一个提交里。
- 不提交生成物、依赖目录、编辑器缓存。
- 不写“fix bug”“update”这类无法回溯的标题。
- 不伪造作者、不抄写来源不明的代码。

### Pull Request

PR 描述至少包含：

1. 变更内容与原因。
2. 影响的层（core/editor/desktop/cli/site/docs）。
3. 执行过的命令与结果；未执行的说明原因。
4. 手工测试矩阵（涉及 UI/IME/文件时）。
5. 数据安全与隐私影响：是否读写文件、是否联网、是否接触文稿内容。
6. 回滚方式或风险点。
7. 截图/录屏（涉及界面时），必须是真实运行结果。

审查规则：

- 至少一名维护者批准；安全、文件写入、许可证变更需要额外审查。
- 不强制要求“所有平台都测过”才能合并小改动，但必须如实标注覆盖范围。
- 维护者可以要求拆分 PR；大而全的 PR 通常退回。
- 合并前保持 CI 绿；当前 CI 已覆盖 Ubuntu 与 Windows 的类型检查、测试、构建和 CLI `doctor`，但不覆盖 GUI、IME、安装包与打印。不能作为绿色依据时，以本地命令输出为准，并明确说明缺口。
- 不在 review 中要求贡献者提供真实用户文稿或密钥。

## 禁止伪造

以下行为直接拒绝：

- 编造测试通过、基准数据、崩溃率、用户数、下载量。
- 用设计稿/合成图冒充实机截图，或把旧截图说成当前版本。
- 把计划中的 AI、RAG、PDF、安装包写成已完成。
- 伪造兼容性声明（“已在所有 Linux 发行版测试”）。
- 伪造安全审计、签名、商标检索结论。
- 引用不存在的 npm 脚本、命令、文件路径或 ADR。

不确定就写“未验证”，这比一个漂亮但假的结论有价值。

## 许可证与贡献授权

- 应用核心计划 AGPL-3.0-only；仓库根目录已有 `LICENSE` 全文（GNU AGPL v3）。
- 插件 SDK、主题与示例计划 MIT，作为独立包各自携带许可证；对应包尚未创建。
- 提交即表示你确认拥有代码版权或足够授权，并同意按所在组件的许可证分发。
- 不提交抄自闭源项目、来源不明或许可证不兼容的代码、字体、图标、fixture。
- 当前没有 CLA。若未来引入，会在 CONTRIBUTING 中明确说明，不追溯已合并贡献。

## 安全问题

不要在公开 Issue 中披露可利用细节、用户文稿样本或密钥。仓库已公开，优先使用 GitHub Security Advisories；如果该通道不可用，通过维护者 GitHub 资料页联系，不要发到公开讨论区。

收到报告后，维护者应确认范围、评估影响、准备修复与发布说明。修复前不在公开渠道复现完整利用链。

## 发布

只有维护者可以发布。Phase 0 只允许维护者部署静态项目站（已部署），不发布 npm 包与安装包。发布前检查：

- `npm ci && npm run typecheck && npm test && npm run build` 全绿。
- Windows/Linux 手工矩阵完成。
- 数据安全与 IME 门槛通过。
- 许可证、签名、校验和、隐私说明就绪。
- 没有未解决的 P0 数据丢失问题。

如果你不确定某个改动是否越界，先开 Issue 描述意图和影响面。Gather 的底线是：文件还在，作者还在做决定。
