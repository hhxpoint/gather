# ADR 0002：编辑器核心使用 CodeMirror 6 + Lezer

- 状态：Accepted（Phase 0）
- 日期：2026-11-21
- 决策者：Gather maintainers
- 相关：ADR 0001（桌面壳）

## 背景

Gather 的编辑器要同时满足四个条件：

1. **Markdown 文件是唯一真相。** 打开、编辑、保存不应经过“富文本模型 → Markdown 序列化”的转换。
2. **写作体验不能像裸文本域。** 标题层级、强调、引用、代码、列表需要视觉反馈，最好有实时预览。
3. **中文输入法必须可靠。** 组合输入、候选框、撤销、标点、emoji 都不能被预览装饰破坏。
4. **AI 修改必须可审阅。** 模型建议要以文本范围进入 diff，逐块接受/拒绝，接受后才写入文档。

候选核心：

- CodeMirror 6 + Lezer
- ProseMirror / Tiptap
- Milkdown（ProseMirror 之上的 Markdown WYSIWYG）
- Monaco
- 原生 `<textarea>` + 预览面板
- Lexical

## 决策

使用 **CodeMirror 6 + Lezer** 作为编辑器核心：

- 文档模型是不可变的文本 `Text`，不是块级 schema。
- Markdown 由 `@codemirror/lang-markdown` + `markdownLanguage` 解析，Lezer 提供增量语法树。
- 实时预览通过 `ViewPlugin` + `Decoration` 实现，不生成第二份文档。
- React 只做挂载与工具栏，不拥有编辑状态；`MarkdownEditor` 暴露 `focus/wrap/prefix/insert/getText`。
- 纯文本编辑命令（`toggleWrap`、`toggleLinePrefix`、`insertAroundSelection`）放在独立模块，可单测。
- 导出/预览 HTML 由 `@gather/core` 的 `marked` + `sanitize-html` 负责，与编辑器解耦。

**ProseMirror/Tiptap 不作为核心。** 它们适合块级富文本、协作、复杂节点视图；但 Gather 的首要问题是 Markdown 保真与源码可控，而不是“像 Notion”。

## 为什么不选 ProseMirror / Tiptap

ProseMirror 的强项是 schema 驱动的富文本：块、内联节点、事务、协作、插件体系。Tiptap 在其上提供更友好的 API 与扩展生态。它们在以下场景明显更强：

- 块级拖拽、嵌套节点、表格 UI；
- 多人实时协作（Yjs 集成成熟）；
- 需要严格 schema 约束的内容（如 CMS）；
- 富文本粘贴清洗、节点视图。

但这些强项与 Gather 的约束冲突：

### 1. Markdown 不是 schema

Markdown 允许大量“不规范但合法”的写法：混合缩进、HTML 块、脚注、frontmatter、表格对齐、围栏代码的特殊信息串、连续空行、行尾空格（硬换行）、未知扩展语法。把这些解析成 ProseMirror 文档，再序列化回 Markdown，很难做到字节保真。每次保存都可能重排空行、改变列表标记、转义字符或丢弃未知语法。

Gather 不能接受“打开再保存，文件 diff 一大片”。这不是测试覆盖率能完全解决的问题，而是模型层面的信息损失。

### 2. 实时预览不需要富文本文档模型

Gather 的预览是“在同一份文本上隐藏/着色标记”，不是“用另一份富文本替换源码”。CodeMirror 的 `Decoration.replace`、`Decoration.mark`、`Decoration.line` 足够表达标题放大、强调着色、引用背景、代码行背景、光标行显示标记。需要图片/表格组件时，可以后续加 widget，但仍然以文本为真相。

### 3. AI diff 更适合文本范围

AI 修改最终要落到 Markdown 文本。CodeMirror 的变更集与选区是字符偏移，diff 可以直接映射到行/块；ProseMirror 的步骤（steps）需要额外的位置映射与 schema 校验。逐块接受/拒绝在文本层更直接，也更容易测试“接受后字节如何变化”。

### 4. 依赖与体积

CodeMirror 是按需组合的模块（state/view/commands/lang-markdown/search），ProseMirror + Tiptap + Markdown 扩展 + 协作栈通常更重。Phase 0 的桌面壳已经是 Electron，编辑器层没有理由再增加一套富文本运行时。

### 5. 锁定风险

Tiptap 的 Markdown 能力、扩展行为与版本演进由上层生态决定；ProseMirror 的 schema 一旦成为核心，后续所有功能（表格、图片、脚注、AI 块）都要在 schema 里建模。Gather 希望把“未知 Markdown”当普通文本保留，而不是报 schema 错误。

## 其他候选

| 方案 | 优点 | 不采用的原因 |
| --- | --- | --- |
| Monaco | 成熟、性能好、IDE 级编辑 | 体积大、Markdown 预览需另做、移动/轻量写作场景过重；语言服务模型偏代码 |
| Milkdown | 开箱的 Markdown WYSIWYG、ProseMirror 生态 | 仍然是富文本模型 → Markdown 序列化，保真风险与 ProseMirror 相同 |
| Lexical | React 友好、现代 | 富文本模型，Markdown 往返同样有信息损失；生态与 IME 验证不足 |
| textarea + 预览 | 极简、字节可控 | 缺少语法树、搜索、装饰、撤销粒度、选区能力；无法做高质量预览 |
| 自研 contenteditable | 完全可控 | 成本极高，IME/选区/撤销/无障碍都是深坑；不值得 |

## Markdown 保真策略

### 原则

1. **编辑的是原文。** 保存时写回编辑器文档字符串，不从 AST 重新生成 Markdown。
2. **预览不改变文本。** 装饰只影响显示，不进入文档。
3. **规范化必须显式。** 行尾、BOM、空行、列表标记的改动要么由用户操作触发，要么在 UI 中说明。
4. **未知语法保留。** 解析器不认识的结构按文本保留，不因“无法建模”而丢弃。
5. **导出是独立路径。** HTML/PDF 导出可以有自己的渲染规则，但不能反向改写源文件。

### 当前实现与已知缺口

当前 `packages/editor` 的做法：

- `EditorState.create({ doc: value })` 接收文件字符串。
- `onChange` 把 `state.doc.toString()` 交给 React。
- 保存时写回该字符串。
- 没有 Markdown 序列化器。

这保证了大部分内容“看到什么就保存什么”，但仍有真实缺口：

- **CRLF 规范化**：CodeMirror 默认按行拆分文档，写回时使用 `\n`。打开 CRLF 文件再保存，行尾可能变成 LF。需要检测原始行尾并在保存时恢复，或明确提示用户。
- **BOM**：`readFile('utf8')` 不会自动去掉 BOM；BOM 可能作为 U+FEFF 出现在文档开头。需要检测、隐藏并在保存时保留，或按显式策略移除。
- **撤销栈**：打开新文件时当前实现通过全文替换同步，history 没有重置；撤销可能回到上一个文档。这是数据风险，必须在 Phase 0 收尾修复。
- **frontmatter**：当前没有专门的 frontmatter 处理与测试；YAML/TOML frontmatter 的节点类型与高亮取决于解析器扩展，不能假设它会被完整理解。文本必须按原样保留，需 fixture 验证。
- **表格**：GFM 表格可以被 Lezer 解析，但当前预览只做行样式，没有表格 widget；导出 HTML 由 `marked` 处理。
- **图片**：编辑器内不渲染图片；导出 HTML 支持 `img`，但协议受白名单限制。
- **原始 HTML**：编辑器按文本保留；导出时经过 `sanitize-html` 白名单，允许的标签会保留，脚本等会被过滤。
- **编码**：只承诺 UTF-8；UTF-16、GBK 等需要后续显式转换，不能在后台猜。
- **大小**：桌面端限制 20 MiB；CLI 无限制。大文档的解析与装饰性能未测量。

### 保真测试基线

建立 `test/fixtures/markdown/`（尚未创建）至少包含：

- LF / CRLF / CR 三种行尾；
- 有 BOM / 无 BOM；
- 有结尾换行 / 无结尾换行；
- YAML frontmatter、TOML frontmatter；
- ATX / Setext 标题混用；
- 嵌套列表、任务列表、松散/紧凑列表；
- GFM 表格、对齐、单元格内代码；
- 围栏代码（含语言信息串、波浪线围栏、嵌套反引号）；
- 原始 HTML 块、行内 HTML、注释；
- CJK、emoji、组合字符、从右到左文本；
- 超长行、大量空行、行尾双空格硬换行；
- 未知扩展语法（脚注、数学、wiki link）按文本保留。

测试方式：读取 fixture → 创建编辑器状态 → 取回文本 → 写文件 → 比较字节。任何不能字节一致的 fixture 必须记录规范化规则、原因与用户可见提示。

## 实时预览设计

### 当前实现

`packages/editor/src/live-preview.ts`：

- 用 `syntaxTree(view.state)` 遍历可见范围。
- 标题节点加 `Decoration.line` 类，改变字号/字重。
- `StrongEmphasis`、`Emphasis`、`InlineCode`、`Link` 加 `Decoration.mark` 类。
- `Blockquote`、`FencedCode`、`BulletList`、`OrderedList` 加行样式。
- `HeaderMark`、`EmphasisMark`、`CodeMark` 在选区不接触当前行时用 `Decoration.replace({})` 隐藏。
- 选区变化、文档变化、视口变化时重建装饰。

`livePreview` 通过 `Compartment` 动态开关。

### 风险

1. **隐藏标记会影响光标与选区。** 当光标进入某行时恢复标记，布局会跳动；跨行选择时可能出现“标记忽隐忽现”。需要固定规则：以光标/选区接触的行为单位，且不在组合输入期间改变装饰。
2. **IME 组合期间重建装饰。** `update.selectionSet` 在组合输入时可能频繁触发；如果装饰导致 DOM 重排，候选框可能漂移。必须在 Windows 微软拼音/搜狗、Linux Fcitx5/IBus 上实测，并在组合期间冻结装饰。
3. **撤销粒度。** 装饰本身不进 history，但隐藏标记会改变用户对“删除了什么”的感知；格式命令必须作为单个事务，避免一次操作产生多个撤销点。
4. **大文档性能。** 每个可见范围都遍历语法树并排序装饰；1 MiB/5 MiB 文档需要基准测试。必要时缓存、限制装饰复杂度、按视口分片。
5. **表格/图片/链接缺失。** 当前预览不是完整渲染，不能宣称“所见即所得”。表格仍是文本，图片不显示，链接不可点击。产品文案必须写“基础实时预览”。
6. **可访问性。** `Decoration.replace` 隐藏的是语法标记，不应隐藏语义内容；屏幕阅读器读到的应是完整文本。隐藏标记可能影响光标导航，需要键盘测试。
7. **主题耦合。** 行类名与 `theme.ts` 耦合；插件/主题以后要稳定类名或提供 API，不能直接依赖内部类。
8. **解析错误恢复。** 未闭合的强调、代码围栏、表格会让 Lezer 产生错误节点；装饰不能在错误节点上崩溃或隐藏错误内容。
9. **HTML 与 Markdown 混排。** 原始 HTML 块的显示与导出清洗规则不同，用户可能看到“编辑器里有、导出后没有”的差异；需要文档说明。
10. **多光标/选区。** 当前 `selectionTouches` 遍历所有 range；多光标下的显示规则需要测试，避免某一行因另一个光标而恢复标记造成闪烁。

### 设计约束

- 预览只做“显示层”，不改变文档、不改写 Markdown、不触发保存。
- 任何需要新 DOM 结构的功能（表格、图片、任务复选框）用 widget decoration，并明确其编辑行为。
- 组合输入期间不重建会改变布局的装饰。
- 关闭预览后，编辑器必须回到纯源码视图，不残留隐藏标记。
- 预览开关不应改变选区、滚动位置或撤销栈。

## AI diff 审阅的架构含义

Phase 2 才实现，但现在要预留正确的方向：

- 模型返回的建议表示为“原文范围 + 替换文本”，不是一份新的 Markdown 文档。
- 审阅 UI 展示逐块 diff；接受时把该块作为一个 CodeMirror transaction 应用，拒绝时不改文档。
- 接受后的修改进入正常撤销栈；一次“全部接受”也应可整体撤销。
- 不接受“模型直接调用保存”的路径；文件写入只由用户保存动作触发。
- diff 算法可以后续引入 `@codemirror/merge`，但不要现在把它变成核心依赖；Phase 0 不实现。
- 发送给模型的内容必须可裁剪；默认不发全文；不把其他文稿作为上下文偷偷带上。

这也反过来说明为什么核心是文本：AI 的输入输出都是 Markdown 文本，diff 的范围与编辑器的范围可以直接对应。

## 测试策略

### 单元测试（当前已有）

- `packages/core/test/markdown.test.ts`
  - GFM 标题/粗体；
  - `<script>` 被过滤；
  - `javascript:` 链接被移除；
  - 图片 https 保留；
  - `rel="noreferrer noopener"`；
  - 表格与任务列表；
  - 文档模板与标题转义；
  - `escapeHtml`；
  - 中英文计数。
- `packages/editor/test/text-commands.test.ts`
  - 选区包裹；
  - 标记外移除；
  - 空选区插入成对标记；
  - 多行前缀添加/移除；
  - 插入链接后选区位置。

这些测试在 2026-11-21 的本地 Windows 环境已通过（2 个测试文件、12 个测试；vitest 5.1.1）。仍然缺少 CI 矩阵、浏览器 DOM 环境下的装饰测试，以及下文列出的 fixture 与属性测试。

### 需要补充的测试

1. **纯函数属性测试**：任意文本、任意选区，执行两次 `toggleWrap` 应回到原文；`toggleLinePrefix` 同理；空选区、跨行、嵌套标记、Unicode 边界。
2. **装饰测试**：用 `EditorState` + Lezer 树验证节点类名与隐藏范围；需要 DOM 环境时用 jsdom/happy-dom，不能在 node 环境硬跑 `EditorView`。
3. **Markdown 保真**：字节级 fixture round-trip，覆盖上文清单。
4. **渲染安全**：更多 XSS 向量（`data:`、`svg`、`onerror`、`style`、嵌套标签、大小写混淆）；允许列表变更必须配测试。
5. **CLI**：临时目录中 `new` 不覆盖、父目录不存在报错、`export` HTML 输出、`--format pdf` 非零退出、`doctor --json` 字段。
6. **IME 手工矩阵**：Windows 微软拼音/搜狗；Linux Fcitx5/IBus；X11/Wayland；组合输入、候选框、撤销、emoji。自动化只能覆盖 composition 事件，最终需要真人签字。
7. **性能基准**：10 万字符输入延迟、1 MiB/5 MiB 打开时间、预览开关耗时、空闲内存；记录硬件与 Node/Electron 版本。
8. **Electron E2E（Phase 1 以后）**：Playwright 驱动窗口，打开/保存/另存/关闭提示；当前没有 E2E 框架。
9. **可访问性**：键盘导航、焦点可见、屏幕阅读器、200% 缩放、对比度。

### CI 矩阵

当前 `.github/workflows/ci.yml` 只在 `ubuntu-latest` 上执行 `npm ci`、typecheck、test、build；本地已生成三个 workspace 的构建产物，但还没有绿色 CI 结果。目标矩阵（尚未完成）：

- Windows 11 + Node 24；
- Ubuntu 24.04 + Node 24；
- `npm ci`、`npm run typecheck`、`npm test`、`npm run build`；
- Linux 下至少跑无 GUI 的单元测试与 CLI；Electron 窗口测试可以放到单独的 xvfb job。

## 后果

### 正面

- 文稿保存不经过富文本序列化，字节保真更容易实现与测试。
- 编辑器核心模块化，预览、搜索、命令可以独立演进。
- AI diff 可以直接使用字符范围，逐块接受/拒绝实现简单。
- 不引入 ProseMirror schema，未知 Markdown 不会被拒绝或丢弃。

### 负面

- 没有开箱的块级拖拽、表格 UI、协作能力；这些需要自建 widget 或后续集成。
- 实时预览是“装饰层”，不是完整 WYSIWYG；表格/图片/链接的呈现要逐个补。
- 隐藏语法标记会带来光标、IME、布局跳动的细节问题，需要大量手工测试。
- 大文档性能需要自己治理，不能依赖富文本编辑器的虚拟化。

### 中性

- 如果未来用户强烈需要 WYSIWYG，可以增加“预览面板/只读渲染”或可选富文本模式，但源码模式与字节保真必须保留；不得把 ProseMirror 变成唯一真相。
- 如果未来做协作，CodeMirror 6 有协作扩展与 Yjs 集成方案，但需要单独 ADR，不在 Phase 0–2 承诺。

## 参考

- CodeMirror 6 文档：`EditorState`、`EditorView`、`Decoration`、`Compartment`、`ViewPlugin`。
- Lezer 与 `@codemirror/lang-markdown` 的 Markdown 节点类型。
- ProseMirror / Tiptap / Milkdown 的 Markdown 序列化行为对比（实现 spike 时记录）。
- 当前代码：`packages/editor/src/live-preview.ts`、`packages/editor/src/index.tsx`、`packages/core/src/markdown.ts`。
