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
- **后续修正**：`signAndEditExecutable: false` 只是本次排查 workaround；staging 验证完成后已从提交配置移除，避免未来签名构建永久跳过 exe 元数据/签名。该条“安装器未产出”只适用于当时环境；后续 P1-34 本地产出 NSIS/portable，P1-35 由 GitHub Actions 在 Windows/Ubuntu 上产出并发布四个安装包，旧结论保留但已被后续证据覆盖。
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
  - 工作区测试 5 个；当时 13 个测试文件、101 个测试，本地 99 通过 + 2 个 POSIX-only 跳过。工作区批次 CI [44983062214](https://github.com/hhxpoint/gather/actions/runs/44983062214) Ubuntu 101 全过、Windows 99 + 2 跳过；Windows 首轮 8.3 短路径失败，修复后通过。
  - 真实截图 `docs/images/gather-workspace.png`（1184×755）。PR #16 合并为 `a874667`；main CI [44983351330](https://github.com/hhxpoint/gather/actions/runs/44983351330) 与 Pages [44983351367](https://github.com/hhxpoint/gather/actions/runs/44983351367) 成功；公网 HTML/CSS SHA-256 与本地一致，6 张产品截图 naturalWidth 全非零。
- **防回归**：工作区打开必须继续走相对路径 + 主进程边界；目录扫描不得跟随符号链接；快捷键分支必须显式检查 Shift；切换文稿前脏状态检查不能绕过。

### P1-29 查找替换只有 keymap、没有搜索状态

- **现象/需求**：编辑器导入了 `searchKeymap`，但从未安装 CodeMirror 的 `search()` 状态扩展；用户没有查找/替换面板，快捷键也没有可靠入口。面板默认英文，与其余中文 UI 不一致。
- **实现**：
  - 加入 `search({ top: true })`，让查询状态、匹配高亮、替换 transaction 和面板都存在。
  - 用 `EditorState.phrases.of` 覆盖查找/替换/上一个/下一个/全部/区分大小写/正则/整词/全部替换/关闭。
  - `Ctrl/Cmd+F` 打开查找，`Ctrl/Cmd+H` 打开并聚焦/选中替换框；菜单“编辑”和工具栏 Search 按钮调用同一 handle；Escape 关闭。
  - 替换全部走 CodeMirror 原生 transaction，Undo 由既有 history 扩展处理。
- **实际踩坑**：
  - 工具栏实现最初在 `openSearchPanel(view)` 后调用 `view.focus()`，会把焦点从搜索框抢回编辑器；移除后搜索框保持聚焦。
  - CDP 直接给面板 input 赋 value 不会触发 CodeMirror 的 `onkeyup` commit；QA 需要同时派发 keyup 或使用真实键盘。这个不是用户路径问题。
- **证据**：
  - 真实窗口：`Ctrl+F` 打开面板，搜索 `Gather` 命中 7 处并高亮；`Ctrl+H` 后面板替换框获得焦点并选中文本；全部替换后正文更新为 `Gather!`；`Ctrl+Z` 恢复原文；Escape 关闭面板。
  - 截图 `docs/images/gather-search.png`（1184×755）；面板包含区分大小写、正则、整词开关。
  - 批次闭环：PR #18 合并为 `a4c63f2`；PR CI [44985468467](https://github.com/hhxpoint/gather/actions/runs/44985468467)、main CI [44985572444](https://github.com/hhxpoint/gather/actions/runs/44985572444) 与 Pages [44985572472](https://github.com/hhxpoint/gather/actions/runs/44985572472) 均成功；公网 HTML/CSS/截图 SHA-256 与本地一致，1440/390 视口无横向溢出。
- **防回归**：`search()` 扩展不能被移除；打开查找后不能调用 `view.focus()` 抢焦点；替换必须使用 CodeMirror command，不能直接改 DOM 或另建文本模型。

### P1-30 工作区搜索：工具进程 error 未监听会让整个应用退出

- **现象/需求**：单文件搜索存在，但工作区里没有跨文稿查找。主进程直接扫描会阻塞窗口；用户正则可能灾难性回溯；点击结果还要打开正确文稿并跳到对应行。
- **实现**：
  - 新增 `workspace-search.ts` 纯扫描核心：字面量转义、正则 `gu/giu`、逐行匹配、预览定位、200 条结果 / 2 MiB 单文件 / 64 MiB 总量 / 每行 3 条。
  - 新增 `workspace-search-worker.ts` 与 `workspace-search-service.ts`：`utilityProcess.fork` 独立扫描，8 秒超时终止；新查询、关闭工作区、关窗和退出都会取消旧进程。
  - 每个候选文件读取前再次调用 `resolveWorkspaceFile`，防止列表生成后替换成符号链接逃逸。
  - 侧栏新增 `Aa` / `.*` 开关、结果摘要与命中列表；`Ctrl/Cmd+Shift+F` 或编辑菜单打开；点击结果通过相对路径回到文件表，再由编辑器 `revealLine` 定位。
- **实际踩坑**：
  - **最严重：`UtilityProcess` 的 `error` 事件没有监听。** 灾难性正则让工具进程触发 V8 错误后，未处理的 `error` 直接冒泡到主进程，整个 Gather 窗口消失，任务栏进程归零，且没有 Crashpad 报告。补上 `child.on('error')` 后复测：`^(a+)+$` 扫描 60k 个 `a` 的文件在 8 秒被停止，UI 显示超时错误，应用继续存活。
  - **点击结果只跳到第 1 行。** `openSearchHit` 在 `await openWorkspaceFile()` 之后用 `pathRef.current` 判断，但 ref 要到下一次 render 才更新，于是把刚设置的 pending reveal 清掉了。改为让 `openWorkspaceFile` 返回布尔值，并在 `documentVersion/path` 的 effect 中执行定位。
  - QA 中刷新工作区后立刻点击结果会偶发找不到命中，因为 280ms 防抖与工具进程启动还没完成；等待结果出现后再点击即可。不是用户路径的数据错误。
- **证据**：
  - 真实窗口：`Ctrl+Shift+F` 打开侧栏搜索，`Gather` 返回 8 处 / 4 个文稿；区分大小写后 6 处 / 3 个文稿；正则 `2026-\d{2}-\d{2}` 返回 2 处 / 2 个文稿；非法正则显示错误；无匹配显示空状态。
  - 点击 `nested/deep/清单.md:4:7` 打开文稿，active line 为第 4 行，DOM selection 位于 `Gather` 前，列号正确；760×600 视口无横向溢出。
  - 截图 `docs/images/gather-workspace-search.png`（1184×755，真实 staging 构建）。
  - 单元测试 `apps/desktop/test/workspace-search.test.ts` 10 个：大小写、正则、非法模式、BOM/CRLF 行号、每行/总量上限、二进制、超大文件、目录逃逸。
  - 批次闭环：PR #20 合并为 `a6b51e1`；PR CI [45101872501](https://github.com/hhxpoint/gather/actions/runs/45101872501)、main CI [45102037935](https://github.com/hhxpoint/gather/actions/runs/45102037935) 与 Pages [45102037910](https://github.com/hhxpoint/gather/actions/runs/45102037910) 均成功；公网 HTML/CSS/截图 SHA-256 与本地一致，8 张产品截图在 1440/390 全部加载。
- **防回归**：`utilityProcess` 必须同时监听 `message`、`error`、`exit` 和 `spawn`；结果定位必须等待文稿版本提交；搜索读取必须重新过工作区边界；8 秒超时不能移除。

### P1-31 会话恢复：窗口越界、最后文稿失效与恢复快照共存

- **现象/需求**：重启后总是默认窗口和示例文稿；用户刚编辑的工作区、最后打开的文稿、窗口位置与尺寸全部丢失。需要“继续上次写的地方”，但不能绕过工作区边界、恢复快照或冲突检测。
- **实现**：
  - 新增 `session.ts`：`WindowStateStore` 与 `WorkspaceSessionStore` 两个独立、带版本的 JSON；异步原子写，窗口关闭使用同步原子写。
  - 窗口保存 `getNormalBounds` + `isMaximized`；启动按当前显示器 `workArea` 选择最大重叠、夹紧尺寸/位置，完全在屏外时在主显示器居中。
  - 工作区会话只保存 `{root, relativePath}`；打开工作区、打开工作区文件、File > Open、Save As 与关闭工作区时更新/清除。
  - 启动 `workspace:restore` 重新 `listWorkspace`，文件只在列表中才恢复；根目录 ENOENT/ENOTDIR 清除记录，权限等暂时错误保留。
  - 渲染层用共享 Promise 只恢复一次（兼容 StrictMode）；若用户已经打开工作区/文件，忽略迟到结果。
- **实际踩坑/判断**：
  - QA 最初直接调用 `window.gather.openWorkspace()`，主进程写入了会话但 App 状态没有更新；这不是产品路径，但说明“会话写入”和“界面状态”必须由同一个 App 动作驱动。正式验证改为点击“打开文件夹”，让 `openFolder` 完成两条链路。
  - 原生文件对话框和快捷键在 QA 中会受窗口焦点影响；改用 UI 自动化元素索引后稳定。产品快捷键此前已单独验证，不把测试工具问题写成产品 bug。
  - 最大化测试中 `Alt+Space` 系统菜单没有被测试工具捕获；双击标题栏才成功。窗口状态文件记录 `maximized:true` 且保留普通 bounds，重启后 `outerWidth=1920 / outerHeight=1032`（主屏 1920×1080），恢复正确。
  - **恢复快照必须仍然出现。** 强杀后恢复工作区/文稿是“打开文件”，不是“恢复未保存内容”；横幅仍显示，用户点击“恢复”后才进入脏状态。
- **证据**：
  - 窗口 120,80,1000×700 → 关闭 → 重启，`screenX=120 / screenY=80 / outerWidth=1000 / outerHeight=700`。
  - 最大化后重启：`window-state.json` 保留 120,80,1000×700 与 `maximized:true`；窗口实际 1920×1032。
  - 工作区 + `nested/笔记.md` 重启：title `笔记.md · Gather`，状态“已恢复上次工作区与文稿 笔记.md”，侧栏 3 个文稿。
  - 删除最后文稿：工作区恢复到 2 个文稿，示例文稿保留，状态“已恢复工作区 … · 上次文稿已不在文件夹”，会话 `relativePath:null`。
  - 重命名根目录：无侧栏、示例文稿保留，状态“上次工作区已不存在，记录已清除”，会话文件被删除。
  - 关闭工作区后重启：无侧栏、示例文稿，窗口尺寸仍恢复；会话文件已删除。
  - 编辑后强杀重启：恢复横幅存在，点击“恢复”得到插入文本，标题变脏，状态“已恢复 笔记.md · 尚未保存”。
  - 单元测试 `apps/desktop/test/session.test.ts` 10 个：矩形归一化、主屏/副屏选择、最小尺寸、异步/同步往返、损坏/版本、非法根/相对路径、清除。
  - 批次闭环：PR #23 合并为 `f4825c8`；PR CI [45109905613](https://github.com/hhxpoint/gather/actions/runs/45109905613)、main CI [45110083947](https://github.com/hhxpoint/gather/actions/runs/45110083947) 与 Pages [45110083883](https://github.com/hhxpoint/gather/actions/runs/45110083883) 均成功；公网 HTML/CSS SHA-256 与本地一致，1440/390 无横向溢出。
- **防回归**：窗口 bounds 必须经过显示器归一化；工作区会话只存路径且恢复必须重新列目录；关闭工作区必须清除会话；Session 恢复不能替代恢复快照；StrictMode 下只能发起一次恢复。

### P1-32 编辑与阅读体验：隐藏编辑器仍可写、撤销栈与预览细节

- **现象/需求**：实时预览已可用，但编辑/阅读工具密度相同；长文缺少真正排版的阅读视图、专注模式、夜间阅读与更安静的版心。简单地把编辑器卸载再显示阅读页会丢 Undo 历史；只把编辑器 `display:none` 又会让键盘继续改到不可见文稿。
- **实现**：
  - 新增 `ReadingView`：`renderMarkdown` 清洗后的 HTML 阅读页，680px 版心、1.95 行高、中文两端对齐、标题/引用/代码/表格/图片/任务列表独立样式、2px sticky 进度条。
  - 阅读模式隐藏应用 chrome，但编辑器保持挂载；新增 `editable` prop，用 Compartment 切换 `EditorView.editable` + `EditorState.readOnly`。退出时 `requestMeasure` 恢复布局与焦点。
  - 专注模式隐藏 header/toolbar/sidebar/footer，保留编辑、搜索、保存与撤销；右上角低对比度退出胶囊。
  - 阅读主题 paper/night 局部 CSS 变量，localStorage 持久化；夜间降低图片亮度。
  - 阅读图片继续走 `image:resolve`；在 HTML 进入 live DOM 之前先用 `DOMParser` 扫描：远程/危险协议替换为占位，本地图片移除 `src` 并记录 `data-reading-src`，等 IPC 返回 data URI 再设置；链接只对 http/https 调用现有 `openLink`。
  - 同步修正实时预览：隐藏 `QuoteMark`；blockquote 全行、ListItem 全行、FencedCode 首尾圆角；字体 17.5px、版心 760px、代码/表格/图片圆角与阴影。
- **实际踩坑/判断**：
  - **隐藏编辑器必须只读。** 若只 `display:none`，CodeMirror 仍可能接收焦点和输入；真实窗口测试在阅读模式聚焦 `.cm-content` 再 `Input.insertText`，文本长度保持 524，未产生不可见修改。
  - **不能卸载编辑器。** 阅读模式保持挂载，退出后插入 `UNDO-MARKER`、进入阅读、退出、Ctrl+Z 能恢复到 524 字符；卸载方案会丢历史。
  - **Escape 有两层语义。** 专注模式下 CodeMirror 搜索面板打开时，Escape 先关搜索，不退出专注；阅读模式进入时主动关闭搜索面板，Escape 直接返回编辑。
  - **预览只给引用/列表首行加类。** 原实现只在 `Blockquote`/`BulletList` 的 `node.from` 加行类，多行引用和后续列表项没有样式；改为 QuoteMark 隐藏 + blockquote 全行 + 每个 ListItem 首行。
  - **远程图片在 effect 前就可能发请求。** 第一版把清洗后的 HTML 直接交给 React，再在 `useEffect` 里找远程 `img` 替换；真实网络面板仍出现 `https://example.com/gather-remote.png` 请求。改为在 `useMemo` 中用 `DOMParser` 预剥离所有非 data `src`：远程直接变占位，本地先留空，effect 只处理 `img[data-reading-src]`。复测 `performance.getEntriesByType('resource')` 为空，远程图片不再产生请求。
  - 阅读截图最初带“未保存”和测试标记；先撤销测试输入并保存，再截桌面图，不用脏状态做展示。
- **证据**：
  - 1184×755 真实 staging：阅读模式正文 680px、表格 568px（等于版心内容宽）、本地图片 naturalWidth 1184、进度 63.71% 可更新；纸色/夜读切换、`gather.readingTheme` 持久化。
  - 专注模式四块 chrome 均为 `display:none`，`.focus-exit` 存在，Esc 恢复 header/footer；`Ctrl+Shift+R` 与 `Ctrl+Shift+Enter` 菜单快捷键生效。
  - 阅读模式 `.cm-content` contenteditable=false；聚焦并插入文本后长度不变。退出后 Undo 历史有效。
  - 远程图片：注入 `https://example.com/gather-remote.png` 后，DOM 无 http img，占位为“远程图片未自动加载 · 远程图片”，`performance.getEntriesByType('resource')` 为空；本地图片仍为 data URI、naturalWidth 1184。
  - 截图 `docs/images/gather-reading.png`（1184×755，94,878 bytes，纸色阅读）。
  - 批次闭环：PR #25 合并为 `b21ee48`；PR CI [45121158938](https://github.com/hhxpoint/gather/actions/runs/45121158938)、main CI [45121313100](https://github.com/hhxpoint/gather/actions/runs/45121313100) 与 Pages [45121313093](https://github.com/hhxpoint/gather/actions/runs/45121313093) 均成功；公网 HTML/阅读截图 SHA-256 与本地一致，9 张产品截图在 1440/390 全部加载。
- **防回归**：阅读视图必须来自 `renderMarkdown` 且在进入 DOM 前剥离非 data 图片 `src`；编辑器不得在阅读模式卸载或保持可编辑；远程图片不得自动加载；阅读模式隐藏编辑器时应关闭搜索面板；专注/阅读 Esc 必须可退出且不吞搜索 Escape。

### P1-33 阅读查找/目录：高亮被代码高亮重写、表格宽度与 Esc 冲突

- **现象/需求**：阅读模式只能从头往下读。需要全文查找、目录、进入/退出时的位置同步、代码语法高亮与阅读导出，同时保持只读派生视图、远程图片阻断和 Undo 历史。
- **实现**：
  - `reading-utils.ts` 解析 ATX/Setext 标题并跳过 fenced code；渲染后按顺序给标题赋 id、`data-source-line`、`data-heading-index`，生成目录与源行映射。
  - 查找在渲染 DOM 上用 `TreeWalker` 生成 Range，CSS Custom Highlight API 注册全部/当前高亮；计数、上一个/下一个、Enter/Shift+Enter、无匹配状态；上限 500。
  - 目录面板、当前标题高亮、点击跳转；进入阅读滚到最近标题，退出把当前标题行交给 `revealLine`。
  - 代码块按 `language-*` 用现有 CodeMirror/Lezer 语言表解析，`highlightTree` + `classHighlighter` 重建 token span，不新增高亮依赖。
  - 阅读 bar 增加查找/目录/PDF/HTML/返回按钮；PDF/HTML 复用既有 `exportAs`。
  - `.reading-table` 包裹表格，宽表在版心内滚动。
- **实际踩坑/判断**：
  - **查找高亮被异步代码高亮冲掉。** 代码 token span 是在挂载后异步重建的；如果搜索先完成，先前 Range 会失效。增加 `contentVersion`，代码高亮完成后重跑查找。
  - **表格 `display:block` 不撑满。** 表格块宽度看似 100%，但单元格只占内容宽；改为 `.reading-table` 包裹 + `table width:100%`，三列表格从约 300px 撑到 568px 内容宽。
  - **滚动到底部时退出同步回退到上一节。** 原来只取视口上方 120px 内的标题；到文档底部时最后一个标题在阈值下方，退出会回到上一节。增加 near-bottom 时选取最后一个标题，实测底部退出落在 `三、搜索与目录`。
  - **Esc 有三层。** 阅读查找/目录的 Esc 必须在 capture 阶段关闭浮层并 stopPropagation，否则 App 会直接退出阅读；两者都关闭后，下一次 Esc 才退出阅读。
  - 阅读导出按钮会打开既有保存对话框；取消不改动文稿。按钮不另写导出逻辑。
- **证据**：
  - 1184×755 staging：目录 5 个标题，点击第 3 项跳到 `scrollTop=655`、进度 36.98%；当前标题高亮；退出后 active line 为 `### 一份小清单`（源行 13）。
  - 查找 `写作`：`1 / 2` → 下一个 `2 / 2`，CSS highlight all=2/current=1；`不存在的词` 显示“无匹配”且 highlight 清空；Esc 关闭查找仍留在阅读。
  - 代码块 37 个 token span，类如 `tok-keyword`、`tok-typeName`、`tok-definition`；760×600 阅读无横向溢出；PDF 按钮打开“导出 PDF”保存对话框，取消后阅读保持。
  - 标题级进入同步：编辑器 Ctrl+End 后进入阅读，滚动到 81–100% 分区；退出落回最后标题源行。该同步不精确到段落/字符。
  - 截图 `docs/images/gather-reading-tools.png`（1184×755，88,464 bytes，目录 + 代码高亮 + 表格）。
  - 批次闭环：PR #27 合并为 `9c233e1`；PR CI [45126930876](https://github.com/hhxpoint/gather/actions/runs/45126930876)、main CI [45127144335](https://github.com/hhxpoint/gather/actions/runs/45127144335) 与 Pages [45127144374](https://github.com/hhxpoint/gather/actions/runs/45127144374) 均成功；公网 HTML/工具截图 SHA-256 与本地一致，10 张产品截图在 1440/390 全部加载。
- **防回归**：查找高亮必须在代码高亮完成后重跑；阅读浮层 Esc 必须先于 App 退出；表格必须经 `.reading-table`；退出同步必须处理 near-bottom；目录/查找不得修改 Markdown 或编辑器历史。

### P1-34 安装包、应用图标与 Release：压缩、静默参数和签名边界

- **现象/需求**：项目只有未签名 staging 目录包和默认 Electron 图标，没有安装器、应用图标、公开下载或校验和；GitHub Pages 的下载区仍是“Not published”。
- **实现**：
  - 新增 SVG 源图标 `apps/desktop/build/icon.svg`：深森林绿圆角板、米白书页、金色叶芽；Chrome 透明背景渲染 1024 PNG，Pillow 生成 16–256 ICO、512 文档图与站点 favicon/Apple touch icon。
  - electron-builder：`win.icon`、`linux.icon`、NSIS 非一键安装/可选目录/快捷方式、portable、`extraResources` 运行时图标；窗口 `icon` 指向 packaged resources 或开发 build。
  - 本地产出 `Gather-Setup-0.1.0-phase.0.exe` 107,158,982 bytes、`Gather 0.1.0-phase.0.exe` 97,381,784 bytes；均未签名。
  - 新增 `.github/workflows/release.yml`：Windows/Ubuntu matrix 构建，publish job 生成 `SHA256SUMS.txt` 并通过 `softprops/action-gh-release` 发布 prerelease；补 `.github/release-body.md` 说明。
- **实际踩坑/判断**：
  - electron-builder 第二次本地构建在 NSIS 压缩阶段长时间占用 7za；第一次最大压缩等待超过 15 分钟被移到后台，随后确认 NSIS 已生成、portable 仍在压缩。改为 `win.compression: normal` 后仍会生成 `.nsis.7z`，但安装器已完成，portable 最终成功；记录的不是“命令失败”，而是大包压缩耗时。
  - Git Bash 会把 `/S` 当路径参数，导致静默安装反而弹出 NSIS 安装选项；用 PowerShell `Start-Process -ArgumentList '/S','/D=...'` 才真正静默。安装到 `C:\Users\Public\GatherInstallQA` 成功，卸载器 `/S` 退出 0，目录清理；便携版也能启动并显示 1184×755 窗口。
  - NSIS 安装后的 `Gather.exe` ProductName=Gather、ProductVersion=0.1.0.0、CompanyName=Gather contributors；`resources/icon.png` 存在；提取 exe 关联图标为 32×32 新图标。
  - `release/` 仍被 `.gitignore` 忽略；不要把安装包提交进仓库或 Pages，Release 资产才是分发渠道。
  - 没有证书；所有签名步骤被跳过，必须在 Release/站点明确 unsigned 与 SmartScreen 风险。
- **证据**：
  - 本地 SHA-256：Setup `43eb057f…`、Portable `d492ffa8…`（本地构建，最终 Release 以 CI 产物和 `SHA256SUMS.txt` 为准）。
  - 安装/卸载：PowerShell 静默安装 exit 0；启动 installed Gather；关闭后 uninstaller `/S` exit 0；临时目录删除。
  - 图标：exe 关联图标 32×32 提取成功；窗口标题栏显示新图标；`resources/icon.png` 598,018 bytes。
  - 站点 favicon 已进入 `apps/site/dist/assets`；Release workflow YAML 通过解析。后续执行时暴露了 Linux scoped 包名与 deb 输出路径问题，见 P1-35；最终运行 45140138861 成功。
- **防回归**：图标必须从 SVG 重生成并检查小尺寸；安装包必须在 Release 附带 SHA256SUMS；静默安装 QA 不能用 Git Bash 直接传 `/S`；unsigned 不得写成签名发布。

### P1-35 Release 工作流：scoped 包名、deb 输出路径与文件名收口

- **现象/需求**：Release 首次真实执行时，Windows job 成功，Linux job 在 AppImage 之后失败；修复后又连续出现配置 schema 错误和 deb 输出目录不存在。目标是把“本地能打包”变成“GitHub Actions 能在同一提交上稳定产出四个安装包并发布”。
- **实现/修复（PR #30–#34）**：
  - Linux 配置增加 `executableName: "gather"`、`syncDesktopName: true`、Debian `maintainer` 与 `homepage`；`dist` 脚本传给 electron-builder `--publish never`，发布只由 workflow 负责，避免 CI 隐式发布。
  - 发布 job 增加 `actions/checkout@v5`，保证 `body_path: .github/release-body.md` 存在。
  - `packageName: "gather"` 必须放在 `deb` 子配置，而不是 `linux`；`linux` 不接受该字段。
  - 显式设置 `linux.artifactName: "Gather-${version}-linux-${arch}.${ext}"`，避免 deb 继续使用 scoped npm 名生成 `release/@gather/...` 路径；AppImage 的 `${arch}` 展开为 `x86_64`，deb 为 `amd64`。
  - portable 显式命名 `Gather-Portable-${version}.exe`，并给 release action 增加 `overwrite_files: true`；重跑后删除旧的不带连字符资产，避免同一 Release 留下两个便携版。
- **根因**：
  - npm workspace 名 `@gather/desktop` 含有 `@` 与 `/`；electron-builder 的默认 executableName 清洗成 `@gatherdesktop`，随后因非法字符拒绝 AppImage。
  - `packageName` 属于 `LinuxTargetSpecificOptions`（deb/rpm 等目标），放在 `linux` 根会 schema 校验失败；即使设置 deb.packageName，默认 artifactName 仍从 app name 推导，路径仍是 `release/@gather/desktop_...deb`。
  - GitHub Release 会把带空格的文件名改写成点号（`Gather 0.1.0-phase.0.exe` → `Gather.0.1.0-phase.0.exe`），不适合作为稳定下载名。
  - publish job 如果没有 checkout，工作区只有下载的 artifact，没有 `.github/release-body.md`。
- **证据**：
  - 失败运行：45135334703（`executableName ... @gatherdesktop`）、45136562424（deb fpm 路径 `release/@gather/...`）、45137610847（`linux.packageName` schema invalid）、45138226673（deb 路径仍为 `release/@gather/...`）。
  - 中间成功：45139088242 产出 AppImage/deb/NSIS/portable；但 portable 名字被 GitHub 改写为 `Gather.0.1.0-phase.0.exe`，随后做命名收口。
  - 最终成功：45140138861，Windows 3m38s、Ubuntu 1m18s、publish 14s；Release `v0.1.0-phase.0` 包含：
    - `Gather-Setup-0.1.0-phase.0.exe` 107,159,310 B / `cdacfcc1…`
    - `Gather-Portable-0.1.0-phase.0.exe` 97,380,409 B / `74df9788…`
    - `Gather-0.1.0-phase.0-linux-x86_64.AppImage` 124,429,055 B / `0342adf2…`
    - `Gather-0.1.0-phase.0-linux-amd64.deb` 96,985,132 B / `0f3d6f98…`
    - `SHA256SUMS.txt` 409 B / `ef4af8e1…`
  - 四个包的 SHA-256 与 GitHub API `asset.digest`、`SHA256SUMS.txt` 三方一致。本机到 `release-assets.githubusercontent.com` 出现持续 TLS 握手失败/低速率，只完成了清单下载；未把“Release 大文件下载并安装”写成已验证。
- **防回归**：
  - 修改 electron-builder 配置后先跑本地 `validateConfiguration`；不要在 `linux` 根猜字段。
  - 任何 scoped workspace 包都必须显式指定 `executableName` 与 `artifactName`，不要依赖默认清洗。
  - publish job 必须 checkout；release action 必须 `overwrite_files: true`；重命名资产后要删掉旧资产。
  - 发布后同时核对 Release API 的 `name/size/digest` 与 `SHA256SUMS.txt`；网络不可用时明确记录证据缺口，不伪造下载/安装结果。

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

跨批次的工程方法、失败模式、检查表与学习路径见 [PLAYBOOK.md](PLAYBOOK.md)；本文件只记录具体故障，不承担方法论索引。
