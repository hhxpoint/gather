# Gather 调试与变更记录

这份日志记录 Phase 0/1 中实际遇到的失败、根因、修复和证据。目的不是写流水账，而是让下一次遇到同类问题时能直接复用判断。

规则：

- 每条记录必须有“现象 / 根因 / 修复 / 证据 / 防回归”。
- 不写真实文稿内容、账户 ID、token、绝对私密路径或用户数据。
- 发布状态、CI 结果与文档更新时间要同步更新；过时结论要显式标注。
- 涉及平台差异的结论必须写清在哪台系统验证、哪台跳过。

---

## Phase 0：骨架与发布闭环

### P0-1 Electron 窗口空白

- **现象**：生产构建能启动，但窗口空白，DevTools 报 `Failed to resolve module specifier "scheduler"`。
- **根因**：`react-dom` 的运行时依赖 `scheduler` 没有被 workspace 安装。
- **修复**：安装 `scheduler@^0.28.0` 后重建。
- **证据**：生产窗口正常渲染，编辑器、工具栏和页脚可见。
- **防回归**：CI 执行完整 `npm run build`；桌面构建不再只做类型检查。

### P0-2 CLI ESM 打包运行失败

- **现象**：CLI 打成 ESM 后运行报 `ERR_MODULE_NOT_FOUND`；把 `@gather/core` 内联后又出现 `Dynamic require of "path" is not supported`。
- **根因**：`sanitize-html`/`postcss` 的 CommonJS 依赖链与 ESM bundle 不兼容。
- **修复**：CLI 改为 CJS 输出，`noExternal: ['@gather/core']`，Node target 20。
- **证据**：`gather doctor`、`new`、`export --out` 实际运行成功；`--format pdf` 以非零状态拒绝。
- **防回归**：CI 双平台执行 `node packages/cli/dist/cli.js doctor --json`。

### P0-3 Vitest 在系统 Node 20 上报 `Map.groupBy`

- **现象**：测试失败后 Vitest reporter 自己崩溃，错误指向 `Map.groupBy is not a function`，真正的失败被遮住。
- **根因**：本机默认 Node 20 太旧；测试与 Vitest 5 需要 Node 22/24。
- **修复**：本地使用 Electron 内置 Node 22 运行 Vitest；CI 固定 Node 24。
- **证据**：`ELECTRON_RUN_AS_NODE=1 electron.exe vitest.mjs run` 能显示真实错误并通过。
- **防回归**：文档明确 Node 版本；CI 不再依赖开发者默认 Node。
- **后续**：在真实失败时改看 `--reporter=json` 或 Electron Node，避免被 reporter 误导。

### P0-4 GitHub `git push` 被网络重置

- **现象**：`git push` 多次 `Recv failure: Connection was reset`；`api.github.com` 可用。
- **根因**：本机到 github.com 的 Git 传输链路不稳定，不是权限或仓库状态问题。
- **修复**：使用 Git Data API 创建 blob/tree/commit/ref，再开 PR；所有 blob 用 `git hash-object` 回读核对。
- **证据**：远端 main 的 46 个文件与本地哈希一致；CI/Pages 均触发成功。
- **防回归**：文档状态与 PR 证据同步；不要仅凭本地 `git status` 推断远端状态。

### P0-5 本地静态预览占用 `dist` 导致构建 EBUSY

- **现象**：`apps/site/build.mjs` 删除 `dist` 时 EBUSY。
- **根因**：本地 Python 静态服务器仍在占用 `dist`。
- **修复**：停止预览服务器后重建；后续预览结束显式关停。
- **防回归**：构建脚本保持先清理再复制；发布由 CI 在干净环境执行。

### P0-6 文档状态落后于真实结果

- **现象**：README/ROADMAP 仍写“仓库未公开、站点未部署、CI 未绿、桌面未验证”。
- **根因**：文档基于早期快照生成，后续验证结果没有回写。
- **修复**：用实际 CI/Pages 运行号、桌面操作和资源哈希更新文档；PR #1 合并。
- **证据**：main CI 44871195373、Pages 44871310195；README 与远端哈希一致。
- **防回归**：每次发布/验证后同步 README、ROADMAP、CONTRIBUTING 与本日志。

---

## Phase 1 第一批：字节保真、冲突与撤销

### P1-1 打开新文件后 Ctrl+Z 回到上一篇

- **现象**：编辑 `crlf-bom.md` 后打开 `lf.md`，按 Ctrl+Z 恢复出上一篇的内容。
- **首次尝试**：在打开文件时用 `history` Compartment 重新配置，期望清空历史。
- **结果**：真实窗口中仍然能撤销到上一篇；重配 history 不是可靠清空方式。
- **修复**：`documentVersion` 变化时用同一组扩展重建 `EditorState`。
- **证据**：真实窗口编辑 `crlf-bom.md` → 打开 `lf.md` → Ctrl+Z，内容保持 `lf.md`，状态不回到脏。
- **防回归**：编辑器不再用“全文替换 + history 重配”处理跨文稿切换。

### P1-2 CRLF/BOM 保存后字节变化

- **现象**：CodeMirror 内部是 LF；直接保存会把 CRLF 文件改成 LF，并丢掉 BOM。
- **修复**：`@gather/core/text-format` 分离编辑文本与存储格式；纯 LF/纯 CRLF/BOM round-trip；混合行尾显式归一为 LF 并在界面提示。
- **证据**：真实窗口 BOM+CRLF 文稿保存后 42 字节逐字节一致；单元测试覆盖无结尾换行与混合行尾。
- **防回归**：文件读取先 `isUtf8` 校验，拒绝 UTF-16/NUL；保存前按原格式编码。

### P1-3 外部修改被静默覆盖

- **现象**：文件在外部被改写后，Gather 保存会覆盖对方内容。
- **修复**：打开时记录 `mtimeMs`、`size`、SHA-256；保存前比较内容指纹，冲突时拒绝覆盖并提供“载入磁盘版本/另存为”。
- **证据**：真实窗口外部改写后 Ctrl+S 显示冲突横幅，外部内容保留；“另存为”成功恢复。
- **防回归**：临时文件写入后、rename 前再次检查目标指纹。

### P1-4 `handleIpc` 包装误替换自身

- **现象**：批量把 `ipcMain.handle(` 替换成 `handleIpc(` 时，wrapper 内部的 `ipcMain.handle` 也被替换，形成递归。
- **根因**：全局字符串替换没有排除 helper 自身。
- **修复**：grep 检查全部 handler，把 helper 内部恢复为 `ipcMain.handle`。
- **证据**：typecheck 通过；20 MiB 错误能正常从主进程返回并显示。
- **防回归**：涉及批量替换时，替换后必须全文搜索关键调用点并实际运行 IPC。

---

## Phase 1 第二批：恢复快照与 watcher

### P1-5 打开另一个文件时是否删除旧快照

- **初始实现**：打开文件时删掉该路径/当前文稿的恢复快照，避免启动横幅堆积。
- **问题**：用户确认“打开其他文件”不等于同意删除唯一的未保存副本；这会制造新的丢稿路径。
- **修复**：快照只在成功保存、明确丢弃、载入磁盘版本后清理；打开另一文件保留旧快照，并刷新恢复列表。
- **证据**：真实窗口编辑 `keep.md` → 打开 `other.md` → userData 中 `keep.md` 快照仍存在。
- **防回归**：恢复快照生命周期只由“保存/丢弃/重载”改变。

### P1-6 保存后旧快照可能被在途 autosave 复活

- **现象风险**：保存开始前已有一个快照写入在途；保存清理快照后，该写入可能又把旧内容写回。
- **修复**：渲染层用 save epoch 使在途快照失效；主进程 `RecoveryStore` 用串行队列，确保保存后的 discard 排在在途写入之后。
- **证据**：新增“写后丢弃串行”测试；保存后恢复横幅消失，重启不出现旧快照。
- **防回归**：快照写/删都走同一队列，不允许绕过。

### P1-7 恢复路径后 watcher 未接管

- **现象风险**：从恢复快照进入一个有路径的文稿后，主进程没有 active path，后续外部修改不会提示。
- **修复**：新增 `recovery:activate`；恢复路径时按快照 baseVersion 启动 watcher，未命名快照则停止旧 watcher。
- **证据**：真实窗口恢复 `keep.md` 后外部改写，2 秒内出现“磁盘文件已在外部修改”；此前正常打开路径也通过。
- **防回归**：渲染层只接受当前路径事件；未命名文稿忽略旧 watcher 事件。

### P1-8 恢复演练中的窗口自动化误判

- **现象**：文件对话框/确认框标题变化或延迟，自动化报 `open dialog missing`。
- **根因**：窗口是异步创建；确认框标题是 `@gather/desktop` 或 `Gather`，文件对话框晚于固定等待出现；旧 window id 可能失效。
- **修复**：每次重新列举窗口，按标题包含关系匹配；重新获取窗口对象；不把自动化超时当成产品失败。
- **证据**：多次重试后真实完成打开、保存、恢复、重载。
- **防回归**：手工矩阵记录系统/窗口状态；不伪造截图或结果。

---

## Phase 1 第三批：故障注入与错误处理

### P1-9 原子写入测试使用 Windows 路径导致 Ubuntu 失败

- **现象**：`replaceFileAtomically('C:\\notes\\draft.md')` 的临时路径断言在 Linux 上分隔符与 dirname 行为不同。
- **根因**：测试硬编码 Windows 路径，但 CI 同时跑 Ubuntu。
- **修复**：改用 `tmpdir()/join()/dirname()` 生成断言；不再依赖反斜杠。
- **证据**：Ubuntu/Windows CI 均通过。
- **防回归**：跨平台测试不硬编码路径分隔符。

### P1-10 原生保存对话框提前拦截“目录不存在”

- **现象**：试图在保存对话框打开后删除目标目录，Windows 对话框自己报“路径不存在”，主进程 IPC 没有收到请求。
- **结论**：这是系统对话框行为，不是 Gather 错误映射失败；不能拿它证明 IPC 错误处理。
- **修复**：用可注入的 atomic ops 覆盖 ENOSPC/EACCES/sync/rename 失败；20 MiB 超限用真实窗口验证。
- **证据**：错误映射单元测试、真实 20 MiB 拒绝、正常保存回归。
- **防回归**：失败路径优先用注入测试，真实 OS 行为另做矩阵，不混淆两者。

### P1-11 20 MiB 编码膨胀测试耗时

- **现象**：CRLF 编码膨胀测试需要构造 16 MB 文本，单测约 3 秒。
- **决策**：保留；它验证的是“读取时未超限、按 CRLF 编码后超限”的真实边界，比只测字符串长度更有价值。
- **证据**：测试稳定通过；完整 suite 约 5 秒。
- **防回归**：若将来启动更慢，可移到单独的 slow suite，但不能删除边界断言。

---

## Phase 1 可复现性批次（当前）

### P1-12 Windows 上无法可靠模拟 POSIX 只读目录

- **现象**：Windows 的 `chmod` 只切换只读属性，不能阻止在目录中创建临时文件。
- **决策**：POSIX 测试在 Windows 标记 skip；Ubuntu CI 用真实 `chmod 0500` 验证 EACCES、原文件保留、旧快照保留。
- **证据**：本地 Windows 显示 `2 skipped`；Ubuntu CI [44888732915](https://github.com/hhxpoint/gather/actions/runs/44888732915) 实际执行，65 个测试全部通过；Windows 同运行 63 通过、2 跳过，job 成功。
- **防回归**：文档明确“真实只读目录”只在 POSIX 验证，不宣称 Windows 已覆盖。

### P1-13 调试经验需要进仓库而不是留在对话

- **问题**：前几批的失败、误判和修复只存在于会话里，后续贡献者无法复用。
- **修复**：新增本日志与 `docs/VERIFICATION.md`；README、CONTRIBUTING 链接；每次修复必须追加记录。
- **证据**：本文件与验证矩阵随 PR 提交；CI 检查文档不影响构建。
- **防回归**：贡献规则要求涉及 bug、平台差异、CI 失败的改动更新本日志。

### P1-14 Git Data API 创建的 PR 没有立即触发 CI

- **现象**：PR #5 通过 Git Data API 创建后，等待 10 秒以上仍没有新的 `CI` 运行；PR 本身状态正常。
- **排查**：确认 head SHA 与分支正确；`pull_request` workflow 无 path 过滤；前几个 API PR 都能触发，因此不是 workflow 语法问题。
- **处理**：关闭 PR 后重新打开，触发 `reopened` 事件；运行 [44888732915](https://github.com/hhxpoint/gather/actions/runs/44888732915) 正常开始并全绿。
- **根因**：未完全确定。可能是 API 创建 ref + PR 的事件投递时序/平台延迟，而不是权限或 YAML 错误。
- **防回归**：API 创建 PR 后不要假设 CI 已触发；显式查询 run 列表；没有运行时用 close/reopen 触发并记录运行号。

### P1-15 electron-builder 拒绝范围版本

- **现象**：`electron-builder --dir` 报 `Electron version "^38.0.0" is a range, not a fixed version`，无法计算平台二进制。
- **根因**：`devDependencies.electron` 使用 `^38.0.0`；electron-builder 需要精确版本，不能依赖 semver 范围。
- **修复**：在 `apps/desktop/package.json` 的 build 配置固定 `electronVersion: 38.8.6`，并补 `author`、`license` 元数据。
- **证据**：错误消失，builder 进入 native rebuild 与 packaging 阶段。
- **防回归**：升级 Electron 时同时更新依赖版本与 `electronVersion`；发布构建必须使用同一个精确版本。

### P1-16 electron-builder 在第二次网络下载上挂起

- **现象**：electron 本体显示下载 100%、native rebuild 完成后，进程在 `packaging` 阶段无输出，600 秒后 `Timeout awaiting 'request' for 600000ms`。关闭 `signAndEditExecutable`、设置 `ELECTRON_BUILDER_OFFLINE=true` 后仍在同一阶段挂起。
- **排查**：`%LOCALAPPDATA%/electron/Cache` 已有 Electron 38.8.6 zip；`electron-builder/Cache` 已有 NSIS 与 winCodeSign。确认不是 Electron zip 缺失；残留 npm/electron-builder 进程被手动终止。
- **根因**：未完全确定。证据指向 electron-builder 的第二个远程工具/校验请求，而不是应用代码、类型检查或 Electron 二进制缺失。
- **临时修复**：新增 `apps/desktop/scripts/stage-portable.mjs`，直接把已安装的 Electron `dist` + `out` 复制成 `release/win-unpacked`，重命名 exe，去掉 `default_app.asar`，写入应用 `package.json` 与 `STAGING-README.txt`。不依赖网络。
- **证据**：产出 328 MB 目录包；`Gather.exe` 启动、打开 Markdown、编辑、保存成功；`resources/app` 仅 3.4 MB。
- **后续修正**：`signAndEditExecutable: false` 只是本次排查 workaround；staging 验证完成后已从提交配置移除，避免未来签名构建永久跳过 exe 元数据/签名。electron-builder 的网络阻塞仍未解决，安装器未产出。
- **防回归**：staging 只用于运行冒烟，不当作安装包；electron-builder 的签名安装包仍必须在网络/证书可用的环境复跑并记录。

### P1-17 打包后运行时验收

- **现象**：需要确认 packaged 模式下的 `__dirname`、preload、renderer、userData 与 CSP 仍然正确，而不是只在 `electron-vite` 预览下可用。
- **修复/验证**：stage 脚本复制完整 `out` 到 `resources/app/out`；启动 `Gather.exe` 后打开/保存真实 Markdown。
- **证据**：窗口正常加载；文件内容写回磁盘；`app.setName('Gather')` 使 userData 仍为 `%APPDATA%/Gather`。staging 说明中明确列出未签名、默认图标、无安装器/自动更新。
- **防回归**：每次改动主进程/preload/renderer 路径后重跑 `npm run stage -w @gather/desktop` 并启动 exe；不能只跑 dev/preview。

### P1-18 恢复路径后 watcher 的首次检查

- **现象风险**：从恢复快照进入路径文稿时，watcher 只会在下一次 fs 事件或 2 秒轮询后检查；如果文件在应用关闭期间被改写且 stat 未变化，首次提示可能被延迟。
- **修复**：`recovery:activate` 启动 watcher 后立即调用一次 `checkNow(true)`，强制做 SHA-256 对比。
- **证据**：watcher 的强制检查行为已有单元测试；真实窗口中恢复后外部改写的提示路径此前已通过。
- **防回归**：恢复/重载路径后必须做一次强制内容检查，不能只依赖被动事件。

### P1-19 Electron 依赖仍是范围版本

- **现象**：虽然 build 配置固定了 `electronVersion`，`apps/desktop/package.json` 的 devDependency 仍是 `^38.0.0`；不同时间 `npm install` 可能解析到不同 38.x。
- **根因**：一开始只修了 electron-builder 的版本解析，没有把依赖声明本身锁死。
- **修复**：把 `electron` devDependency 与 `package-lock.json` 的 workspace spec 同步改为精确 `38.8.6`。
- **验证**：`npm ci --dry-run --ignore-scripts` 退出 0；`npm ls electron --depth=0` 显示 `38.8.6`。
- **防回归**：打包相关依赖必须精确版本；升级 Electron 需同时更新 package.json、lock、electronVersion 和 IME/PDF 回归记录。

### P1-20 截图示例里的代码块被 shell 命令替换吞掉

- **现象**：第一版截图中的示例文稿只有“一段代码”标题，没有代码块；单元测试与页面都正常。
- **根因**：用双引号包裹 `node -e "...```ts..."` 创建 fixture，反引号被 bash 当作命令替换执行，三反引号被吃掉。
- **修复**：改用 Write 工具直接写 Markdown fixture，重新打开文件并截图。
- **证据**：真实截图出现 TypeScript 代码块；文件内容用 `sed` 回读确认。
- **防回归**：生成含反引号/`$`/引号的 fixture 时不要用 shell 拼字符串；使用文件写入工具或 heredoc。

### P1-21 项目站视觉核验中的滚动、懒加载与移动端问题

- **现象**：
  - headless Edge 的 `#product` 截图停在 hero，因为 CSS `scroll-behavior: smooth` 与截图时序冲突。
  - CDP 在 reload 后立即截图，得到旧 compositor 画面/空白懒加载图片。
  - 390px 移动端：Phase chip 在内部换行、发布状态栏挤成两三列、manifest 表头仍显示三列。
- **根因**：QA 工具时序 + 真实响应式 CSS 缺口，不是单一页面错误。
- **修复**：
  - QA 脚本设置 `scrollBehavior='auto'`，用 CDP 精确滚动并等待绘制；最终采用真实截图 + headless Edge 分段检查。
  - 移动端让 eyebrow/chip 可换行、chip 不内部断行；发布状态栏换行、移动端隐藏 manifest 表头；已重新截图确认。
- **证据**：`/product`、`/features`、`/cli`、`/download`、`/roadmap` 桌面截图；390×844 移动端 top/product/download 截图；scrollWidth 始终等于 clientWidth。
- **防回归**：站点改动必须同时检查桌面与 390px 移动端；截图 QA 不能只看 DOM 快照。

### P1-22 项目展示仍停留在 Phase 0

- **现象**：产品已经进入 Phase 1，但官网仍写“Phase 0 构建中”、没有真实截图，README 也没有产品画面。
- **修复**：用 staging 应用真实截图重建项目站：新增产品截图区、文件安全卡片、工程证据、真实下载状态；README 顶部加入真实界面与工程证据链接。没有伪造下载、用户文稿或“AI 已上线”。
- **证据**：项目站本地构建包含 3 张仓库内截图；桌面/移动视口检查通过；Pages 运行 44912794773 后，公网 Phase 1 页面、3 张截图与资源字节数已核验。
- **防回归**：产品状态变化时同步项目站、README、DEBUG_LOG、VERIFICATION，避免“代码前进、展示落后”。

### P1-23 Pages 部署在 upload 与 deploy 同 job 时找不到 artifact

- **现象**：Phase 1 站点合并后，Pages build 成功、`upload-pages-artifact@v3` 成功，但 `deploy-pages@v4` 连续两次报 `No artifacts named "github-pages"`；REST API 确认 artifact 已存在（569,502 bytes），GitHub Status 显示 Actions/Pages operational。
- **根因**：已知的 artifact 列表最终一致性竞态。upload 与 deploy 在同一个 job 里紧挨着执行，deploy 按名字查询时 upload 刚 finalize，列表可能还没可见；重跑同一 layout 会再上传一个同名 artifact，反而触发 “Multiple artifacts”。参考 `actions/deploy-pages#451`。
- **修复**：
  - 把 Pages 拆成 `build`（checkout、npm ci、站点构建、configure-pages、upload）与 `deploy`（`needs: build`、environment、deploy-pages）两个 job。
  - 升级到 Node 24 原生 major：checkout@v5、setup-node@v5、configure-pages@v6、upload-pages-artifact@v5、deploy-pages@v5。
  - 同步把 CI 的 checkout/setup-node 升到 v5，消除 Node 20 deprecation 警告。
- **证据**：修复后 Pages 运行 [44912794773](https://github.com/hhxpoint/gather/actions/runs/44912794773) 成功；build 14s、deploy 9s；artifact 在 job 边界之后查询；公网页面与 3 张截图资源均已核验。
- **防回归**：Pages 永远保持 upload 与 deploy 跨 job；不要在同一 job 里重跑以“修复”找不到 artifact 的错误。

### P1-24 桌面 PDF/HTML 导出：本地图片、原子写与真实 PDF 回读

- **现象/需求**：桌面端只能保存 Markdown；CLI 只能导出 HTML。用户需要把当前编辑器内容导出为 PDF 或可独立分享的 HTML，且中文、GFM 表格、代码块和本地图片不能丢。
- **设计约束**：不引入 Pandoc/LaTeX/付费服务；渲染层不接触 Node 文件系统；导出不能使用相对路径把任意本地文件交给 Chromium；失败不能留下半文件。
- **实现**：
  - 主进程复用 `renderDocumentHtml` 的清洗结果；HTML 直接写目标文件，PDF 用隐藏 `BrowserWindow` 加载临时 HTML 后 `printToPDF`（A4、`preferCSSPageSize`、背景、tagged PDF）。
  - 本地相对图片在清洗后的 HTML 中扫描 `<img>`，只嵌入 png/jpg/jpeg/gif/webp/avif/bmp；`realpath` 后必须仍在文稿目录，单图 8 MiB、整篇 24 MiB；目录外/SVG/缺失/超预算只告警。
  - 导出 IPC 校验格式、20 MiB Markdown 与文件名；目标文件走临时文件 + fsync + rename；工具栏与文件菜单各自触发同一条 IPC。
- **实际踩坑**：
  - 隐藏窗口如果使用 `data:` URL，大图片会让 URL 过长且不利于本地图片；改为系统临时目录中的 HTML 文件，完成后递归清理。
  - `pdftotext` 只能抽到 Latin 文本，中文变成空白/乱码；这是验证工具的编码/CMap 读取问题，不是 PDF 缺字。改用 `pdfjs-dist` + `@napi-rs/canvas` 回渲染：4 页都能抽出完整中文，且页面图像可见中文、表格和图片。
  - Windows 原生文件对话框不接受正斜杠路径；自动化最初用 `C:/...` 得到“文件名无效”，改用反斜杠后成功。这是 QA 脚本问题，不是导出实现问题。
- **证据**：
  - 真实窗口：打开合成文稿 `export-demo.md`，导出 `export-demo.pdf` 418,240 bytes；`pdfjs-dist` 抽取 4 页中文文本并渲染 PNG，页面含标题、表格、代码块与本地截图。
  - 同文稿 HTML 273,742 bytes；1 个 `data:image/png;base64`，0 个 `src="assets/gather-editor.png"`，1 个 `<table>`，`@page` 规则存在；headless Chrome 打开 HTML 截图通过。
  - 工具栏显示“已导出 export-demo.pdf · 408 KB”“已导出 export-demo.html · 267 KB”；文件菜单显示“导出 PDF… Ctrl+Shift+E”“导出 HTML…”。
  - 本地测试 9 个文件、75 个测试，73 通过 + 2 个 POSIX-only 跳过；新增 9 个导出边界测试。CI [44917922628](https://github.com/hhxpoint/gather/actions/runs/44917922628) Ubuntu 75 全过、Windows 73 + 2 跳过；PR #12 合并后 main CI [44918269575](https://github.com/hhxpoint/gather/actions/runs/44918269575) 与 Pages [44918269622](https://github.com/hhxpoint/gather/actions/runs/44918269622) 均成功。
- **防回归**：导出目标必须继续走原子替换；本地图片必须同时有目录逃逸、缺失、SVG、代码块误伤与数据 URI 测试；改打印 CSS 或 Electron 主版本后必须用真实中文文稿重新生成 PDF 并用 PDF 渲染器回读，不能只看 HTML。

### P1-25 PDF 验证不能只看 pdftotext 或浏览器直接截图

- **现象**：
  - `pdftotext -layout export-demo.pdf` 只留下 Latin 字符，中文全部为空，容易被误判为“PDF 中文没写进去”。
  - Chrome headless 直接打开 `file:///...pdf` 截图得到深色空白，属于内置 PDF viewer 在 headless 下的渲染限制。
- **根因**：Poppler 对该 Chromium 打印 PDF 的 CMap/编码抽取不完整；headless Chrome 的 PDF viewer 不保证在截图模式下绘制。
- **修复/验证路径**：用 `pdfjs-dist` 的 `getTextContent()` 抽取文本，用 `@napi-rs/canvas` 渲染页面为 PNG 后人工检查；两者都显示完整中文、表格、代码块与图片。
- **证据**：4 页文本抽取通过；`pdf-render-1.png` / `pdf-render-3.png` 可见标题、表格与嵌入截图；仓库内展示图 `docs/images/gather-pdf-export.png` 即该真实渲染结果。
- **防回归**：PDF 验收至少包含“文本抽取 + 页面渲染”两条证据；不要用单一命令行工具的失败否定整个 PDF。

### P1-26 新增导出卡片把 Features Grid 在窄屏撑宽

- **现象**：新增 `06 / Export` 卡片后，390px 检查截图里所有能力卡片的右侧被裁掉；卡片内部的 PDF 预览也把行高撑得很大，标题被挤到很下面。
- **根因**：卡片内部使用 Grid，图片的固有宽度（952px）参与 min-content 计算；子项没有 `min-width: 0`，导致外层单列 Grid 被撑到图片宽度。图片的固有高宽比也参与了 1fr 行的最小高度计算。
- **修复**：给导出卡、内容列和预览容器加 `min-width: 0`；预览容器改为固定 `height: 300px`（平板上 230px、手机 210px），图片继续 `object-fit: cover` + `object-position: top`；移动端使用 `minmax(0, 1fr)`。
- **证据**：headless Chrome 的 `--window-size=390` 实际布局视口最小为 500，截图被裁切，容易误判；改用 CDP `Emulation.setDeviceMetricsOverride` 真实 390×844 后 `scrollWidth = clientWidth = 390`，四张图片 `naturalWidth` 均非零，导出卡片完整显示；桌面 1440 视口 `scrollWidth = clientWidth = 1422`。
- **防回归**：新增含图片的卡片必须在 390px 用 CDP 设备模拟检查，不能只用 headless `--window-size`；Grid 子项默认 `min-width: auto`，放图片时必须显式归零。

### P1-27 实时表格/图片预览：block decoration、lazy 图片与外链边界

- **现象/需求**：实时预览只显示 GFM 表格源码和 `![alt](src)`；用户希望写作时看到表格与本地图片，同时能一键回到源码，且不能把任意本地文件或网络地址交给渲染层。
- **实际踩坑**：
  - 表格跨行，必须使用 block decoration；CodeMirror 6 不允许 ViewPlugin 提供 block decoration，会抛 `Block decorations may not be specified via plugins`。改成 StateField 持有表格扫描结果与 DecorationSet，ViewPlugin 只处理行内样式、链接和图片；表格子树在 ViewPlugin 中直接跳过，避免重叠。
  - 图片第一次一直停在“正在加载图片…”。IPC 实际已返回 268,682 字符 data URI，`img.src` 已设置，但 `img.complete=false`。根因是 CSS 先 `display:none`，同时给图片设了 `loading="lazy"`；隐藏且未进入布局的图片不会启动懒加载。改成 `loading="eager"`（widget 本来只在可见区域创建），加载/失败状态再切换 CSS。
  - 测试环境里的 `contextBridge` API 不可写，无法通过替换 `openExternalLink` 捕获调用；改用 CDP `Input.dispatchMouseEvent` 发送真实 Ctrl+点击，状态栏显示“已在系统浏览器中打开链接”。
  - `pdftotext` 和 headless 浏览器不能作为 PDF/图片预览的唯一证据；图片预览用 CDP 检查 naturalWidth/complete，并用真实截图回看。
- **实现**：
  - 表格：`Table` 节点扫描 → 核心 `renderMarkdown` 单表清洗 → block widget；光标触及范围或点击时移除 widget；超过 1.5 MiB 文稿或 50k 字符表格退回源码。
  - 图片：主进程 `resolvePreviewImage` 以当前文稿目录为根做 `realpath`/目录包含/位图/8 MiB 校验；5 秒、40 项缓存；返回 data URI。远程、绝对、`file:`、目录逃逸一律不读取。
  - 外链：普通链接 Ctrl/Cmd+点击、表格链接单击；主进程 `safeExternalUrl` 只放行 http/https，拒绝凭据、`javascript:`、`file:`、`data:`、mailto 与畸形值。
- **证据**：
  - 真实窗口 + CDP：表格 widget 1 个；点击后 widget 0 个且出现 `| 能力 |` 源码行；Control+End 离开后 widget 恢复 1 个。
  - 图片 widget `complete=true`、natural 2560×2800、显示 567×520（max-height 520）；点击后 widget 消失并出现 `![Gather 编辑器真实界面](assets/gather-editor.png)` 源码行。
  - 图片预览 data URI 长度 268,682；主进程非法外链调用返回“只允许打开 http/https 链接。”；Ctrl+点击真实链接后状态栏显示“已在系统浏览器中打开链接”。
  - 新增 6 个预览解析测试、5 个图片边界测试、10 个外链测试；当前 12 个测试文件、96 个测试，本地 94 通过 + 2 个 POSIX-only 跳过。预览批次 CI [44974544499](https://github.com/hhxpoint/gather/actions/runs/44974544499) Ubuntu 96 全过、Windows 94 + 2 跳过。
  - 新增真实截图 `docs/images/gather-table-preview.png`、`gather-image-preview.png`（1184×755）。PR #14 合并为 `4e0c1e9`；main CI [44981317065](https://github.com/hhxpoint/gather/actions/runs/44981317065) 与 Pages [44981317068](https://github.com/hhxpoint/gather/actions/runs/44981317068) 成功；公网 HTML/CSS SHA-256 与本地一致，5 张产品截图 naturalWidth 全非零。
- **防回归**：表格必须继续走 StateField block decoration；图片必须保持 eager 或显式 `img.decode()`；所有本地图片读取必须复用主进程目录边界；外链必须经过 `safeExternalUrl`，不能在渲染层直接 `window.open` 或 `location.href`。

### P1-28 文件夹工作区：目录边界、侧栏与 Ctrl+Shift+O 快捷键冲突

- **现象/需求**：站点写着“打开一个文件夹，就打开全部文稿”，应用却只能打开单篇文件；用户需要在同一文件夹内快速切换。
- **实际踩坑**：
  - `Ctrl+Shift+O` 最初打开的是**文件**对话框，不是文件夹。渲染层 keydown 只判断 `event.key.toLowerCase() === 'o'`，忽略 `shiftKey`，在菜单 accelerator 之前就把 `Ctrl+Shift+O` 当成 `open()`。修复为 `shiftKey ? openFolder() : open()` 后，真实快捷键打开“打开 Markdown 工作区”。
  - 文件夹列表如果跟随符号链接，会越过用户选择的根目录；首版直接跳过 `Dirent.isSymbolicLink()`，打开文件时再做 `realpath` 包含检查。
  - 如果直接信任渲染层传来的绝对路径，工作区会成为任意文件读取入口；因此渲染层只发相对路径，主进程用 `resolve` + `realpath` + `relative` 边界双重校验。
  - Windows CI 第一次失败：`mkdtemp` 返回 8.3 短路径 `RUNNER~1`，`realpath` 返回 `runneradmin`，测试把短根与长候选比较，误判为“链接逃逸”。修复为 `resolveWorkspaceFile` 内部先 realpath 根目录，测试也统一使用 realpath 根；这是实际路径语义差异，不是放宽边界。
- **实现**：
  - `workspace.ts` 递归列 `.md/.markdown/.mdown/.mkd/.txt`；跳过隐藏项、`node_modules/out/dist/release/coverage` 与符号链接；最多 2000 个、深度 8；返回 `truncated`。
  - 主进程保存 `workspaceRoot`；`workspace:open/refresh/openFile/close` IPC；打开文件复用现有 `readMarkdownFile` 与 watcher。
  - UI 侧栏展示工作区名、相对路径、当前文件、刷新/关闭；切换脏文稿前确认；打开同一文件只聚焦，不重建状态。
- **证据**：
  - 真实窗口打开 `C:\Users\Public\gather-workspace-qa`：侧栏 3 个文稿（`01-欢迎.md`、`nested/笔记.md`、`nested/清单.txt`），隐藏 `.private`、`node_modules` 与非 Markdown 图片未出现。
  - 打开 `nested/笔记.md` 后标题、嵌套路径与表格预览正常；修改后点击 `01-欢迎.md` 出现“当前文稿有未保存修改”确认；取消/确认路径均可用；保存状态显示“已保存 笔记.md · UTF-8 · LF”。
  - 工作区测试 5 个；当前 13 个测试文件、101 个测试，本地 99 通过 + 2 个 POSIX-only 跳过。
  - 真实截图 `docs/images/gather-workspace.png`（1184×755）。
- **防回归**：工作区打开必须继续走相对路径 + 主进程边界；目录扫描不得跟随符号链接；快捷键分支必须显式检查 Shift；切换文稿前脏状态检查不能绕过。

---

## 维护约定

新增记录时复制以下结构：

```text
### 编号 · 标题
- 现象：
- 根因：
- 修复：
- 证据：
- 防回归：
```

如果结论后来被推翻，不要删除旧记录；追加“后续修正”，保留当时为什么判断错误。这样日志才有调试价值。
