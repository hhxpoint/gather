# ADR 0012：阅读查找、目录、源行同步与代码高亮

- 状态：Accepted
- 日期：2026-11-23
- 范围：`apps/desktop/renderer`

## 背景

阅读模式已经有独立版心与主题，但长文仍只能从顶部往下读。用户需要目录跳转、全文查找、进入/退出阅读时保留大致位置，以及代码块的可读语法高亮；同时不能破坏只读派生视图、远程图片阻断和撤销历史。

## 决策

1. **查找使用 CSS Custom Highlight API。** 在渲染后的阅读 DOM 上走 `TreeWalker`，为文本节点创建 `Range`，注册 `gather-reading-find` 与 `gather-reading-find-current` 两个 highlight；不修改 HTML、不插入 `<mark>`，关闭查找即可清理。上限 500 个匹配；无匹配与计数在浮层显示。
2. **查找 UI 属于阅读视图。** `ReadingView` 暴露 `openSearch`、`toggleToc`、`getActiveSourceLine` 三个句柄；App 的 `Ctrl/Cmd+F` 在阅读模式调用阅读查找，否则走 CodeMirror。查找 Enter/Shift+Enter 下一个/上一个，Escape 先关闭查找，不退出阅读。
3. **目录由源标题生成并映射源行。** `reading-utils.ts` 解析 ATX/Setext 标题，跳过 fenced code；`prepareReadingHtml` 按渲染顺序给 `h1–h6` 赋 id 与 `data-source-line`/`data-heading-index`。目录面板按层级缩进，点击跳转；滚动时根据当前视口高亮最近标题。
4. **源行同步是标题级近似，不伪装成精确映射。** 进入阅读时把编辑器当前行映射到最近标题并滚动；退出时把当前标题的源行交回编辑器 `revealLine`。文档没有标题时从顶部开始。不声称支持段落级或字符级映射。
5. **阅读查找与目录互斥。** 打开目录关闭查找，打开查找关闭目录；两者都通过 capture 阶段 Esc 先关闭自己，避免 App 直接退出阅读。
6. **代码高亮复用已有语言栈。** 使用 `@codemirror/language` 的 `LanguageDescription`、`@codemirror/language-data` 的语言表、`@lezer/highlight` 的 `highlightTree`/`classHighlighter`，按 fenced code 的 `language-*` 异步加载语言并重建 code DOM；不引入新的第三方高亮库或远程服务。无语言或加载失败时保持等宽纯文本。
7. **阅读导出复用现有管线。** 阅读 bar 的 PDF/HTML 按钮调用既有 `exportAs`，使用同一编辑器文本、A4 打印 CSS、图片边界与原子写；不另建阅读导出格式。
8. **表格在阅读视图中包裹滚动容器。** 由 `prepareReadingHtml` 包 `.reading-table`，让三列表格真正占满版心，宽表格在容器内横向滚动。

## 被否方案

- **`window.find` 或给 HTML 插入 `<mark>`。** `window.find` 不可控且会移动选区；插 mark 会破坏只读派生 DOM 与搜索状态清理。
- **使用第三方高亮库。** 会增加包体、许可证和另一套主题；现有 CodeMirror/Lezer 语言栈已足够。
- **精确源行到 DOM 映射。** 需要给每个段落/文本节点生成源位置，首版成本高且容易漂移；标题级近似已覆盖长文导航的主要需求。
- **阅读查找使用另一份纯文本副本。** 会与渲染 DOM、图片占位和目录脱节。
- **打开查找/目录仍让 App 的 Esc 生效。** 用户按一次 Esc 会直接退出阅读，体验错误。

## 后果与边界

- 已验证（Windows staging 1184×755/760×600）：目录 5 个标题、点击跳转、当前标题高亮；查找 `写作` 2 个匹配、`1 / 2` → `2 / 2`、CSS highlight 2/1、`无匹配` 清理；Esc 关闭查找/目录而不退出阅读；代码块 37 个 token span；进入/退出阅读按标题同步源行；阅读导出打开保存对话框。
- 查找只覆盖当前阅读文稿，不支持正则、替换、跨文稿结果或持久化历史；标题级同步不精确到段落/字符；目录只显示标题，不显示图片/表格。
- CSS Custom Highlight API 在 Electron 38 所用 Chromium 中可用；其他运行时需降级为仅计数/滚动或另做实现。
- 代码高亮依赖语言表动态加载；语言不支持、语言加载失败或代码块超过 200k 字符时保持纯文本。夜间 token 颜色只覆盖阅读视图，不是编辑器主题。

## 复现

```bash
npm run stage -w @gather/desktop
# 打开含多级标题、代码块、表格、本地/远程图片的合成文稿
# 阅读模式：Ctrl/Cmd+F 搜索 "写作"；Enter 下一个；Esc 关闭
# 打开目录，点击标题；滚动后 Esc -> 返回编辑，观察光标落在最近标题
# 阅读 bar 点击 PDF/HTML，确认保存对话框；取消
```
