# ADR 0011：阅读模式、专注模式与阅读主题

- 状态：Accepted
- 日期：2026-11-23
- 范围：`apps/desktop/renderer`、`packages/editor`

## 背景

Gather 已经有实时预览，但“编辑”和“阅读”仍是同一个工具密度的界面：顶部品牌、文件操作、格式工具栏、工作区侧栏与底部状态栏一直占据空间。长文阅读时，用户需要更大的版心、更少的控制和真正排过版的表格/代码/引用；写作时，用户需要一个不被打断、但随时能退回的专注状态。

不能为了阅读模式再引入一份可编辑文档模型。阅读必须从同一份 Markdown 源文本派生；切换模式不能丢撤销历史；远程图片不能被阅读视图自动加载；任何新界面都必须有真实窗口证据。

## 决策

1. **阅读模式是派生的只读视图。** 使用 `renderMarkdown`（已清洗）生成 HTML，放进 `.reading-article`；不建立第二份文档、不改变源文本。表格、代码、引用、图片、任务列表都由 HTML + CSS 呈现。
2. **编辑器保持挂载但只读。** 阅读模式通过 CSS 隐藏应用外壳（header/toolbar/sidebar/footer）并显示 `.reading-shell`；`MarkdownEditor` 不卸载，`EditorView.editable(false)` + `EditorState.readOnly(true)` 阻止隐藏编辑器接收输入。退出时 `requestMeasure` 重新布局，撤销历史与光标仍在。
3. **阅读主题局部化。** 阅读模式有 `paper` 与 `night` 两套 CSS 变量；夜间只影响阅读外壳与文章，不重做整个应用主题。主题选择写入 `localStorage`，下次进入阅读保持。图片在夜间降低亮度，避免刺眼。
4. **图片和链接继续走安全边界。** 清洗后的 HTML 在进入 DOM 前先用 `DOMParser` 处理图片：本地相对图片移除 `src` 并记录 `data-reading-src`，通过现有 `image:resolve` 主进程 IPC 获取 data URI 后再设置；远程/危险协议直接替换成“远程图片未自动加载”占位，绝不插入 live DOM。链接只对 http/https 调用 `openLink`，其他 href 阻止默认导航但不打开。
5. **专注模式隐藏 chrome，但保留编辑。** 隐藏 header/toolbar/sidebar/footer，编辑器填满窗口，顶部右侧保留低对比度“退出专注 Esc”胶囊；编辑能力、搜索、撤销、保存不变。阅读和专注互斥，Escape 退出；搜索面板打开时 Escape 先交给搜索面板。
6. **阅读排版使用独立的阅读变量。** 正文 17.5–19px、行高 1.95、版心 680px、两端对齐（窄屏改左对齐），标题、引用、代码、表格、图片、分隔线、任务列表分别定义；阅读进度条使用 2px sticky 线。
7. **快捷键与菜单统一。** View 菜单新增“阅读模式”`CmdOrCtrl+Shift+R` 与“专注模式”`CmdOrCtrl+Shift+Enter`；header 提供图标按钮；阅读 bar 提供主题切换与“返回编辑 Esc”。快捷键走 Electron 菜单，避免和 renderer 的搜索/查找快捷键冲突。

## 被否方案

- **阅读模式卸载编辑器再挂载。** 会丢 Undo 历史和选区；只隐藏 DOM 更安全。
- **隐藏编辑器但仍可编辑。** 用户按键会改到不可见文稿；必须设置 `editable/readOnly`。
- **阅读视图直接加载远程图片。** 打开文稿就产生网络请求，违反本地优先与“远程图片不自动加载”的既有边界。
- **阅读模式使用 `renderDocumentHtml` 打印模板。** 那是 A4 打印文档，不是屏幕阅读版心。
- **全应用 dark mode。** 阅读主题先局部化，避免一次性改动所有侧栏/搜索/冲突横幅；全应用主题需要单独矩阵。
- **滚动位置/光标映射。** 首版阅读从顶部开始；精确映射 Markdown 行到渲染后 DOM 需要额外锚点，先不承诺。

## 后果与边界

- 已验证（Windows staging，1184×755）：阅读模式 680px 版心、引用、代码、表格、本地图片 data URI、进度条、纸色/夜读切换与持久化；隐藏编辑器在阅读模式不可输入；退出后撤销历史可恢复；专注模式隐藏全部 chrome，Esc 退出；快捷键与 header 按钮均生效。
- 阅读模式不提供全文查找、目录、标注、滚动/光标同步、打印或导出；这些是后续工作。
- 远程图片在 HTML 进入 DOM 前就被替换为占位；真实测试中 `performance.getEntriesByType('resource')` 无远程图片请求。链接仅打开 http/https。阅读 HTML 来自已清洗的 `renderMarkdown`，不得改为直接插入原始 Markdown HTML。
- 夜间主题只覆盖阅读外壳，不改变编辑界面；全应用主题、Linux 字体回退与 200% 缩放仍未跑。
