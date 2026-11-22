# ADR 0006：实时表格/图片预览与受控外链

- 状态：Accepted
- 日期：2026-11-22
- 范围：`packages/editor`、`apps/desktop`

## 背景

Phase 1 之前，实时预览只给标题、强调、行内代码、链接和代码块加样式；GFM 表格仍显示为 `| ... |` 源码，图片仍显示 `![alt](src)`。用户希望写作时能看到完整内容，但不能把源码变成第二份文档模型，也不能让打开文稿就访问网络或读取目录外文件。

## 决策

1. **Markdown 源文本仍是唯一真相。** 表格与图片都只是 Decoration；没有隐藏的富文本状态，切换预览或读取文件仍使用同一串文本。
2. **表格使用 StateField block widget。** CodeMirror 6 不允许 ViewPlugin 提供 block decoration，因此表格预览由 StateField 管理：文档变化时扫描 `Table` 节点并缓存渲染 HTML，选择变化时只重算哪些表格被光标触及，不重复解析整篇。
3. **表格 HTML 复用核心清洗。** 用 `@gather/core` 的 `renderMarkdown` 渲染单个表格片段，再放进 widget；链接、单元格内容和 HTML 都经过既有白名单，不把用户原文直接 `innerHTML`。
4. **点击回到源码。** 光标进入表格范围或点击表格时移除 block widget；图片同理，点击后把选区放到 `Image` 节点起点。这样不会出现“富文本里能点、源码里找不到”的双模型。
5. **表格预览有性能阈值。** 超过 1.5 MiB 的文稿不扫描表格；单个表格超过 50k 字符或超过 30 个表格时退回源码。宁可少装饰，不在大文稿上每键做全量渲染。
6. **本地图片经主进程边界。** 渲染层只把相对 `src` 发给主进程；主进程以当前文稿目录为根做 `realpath`、目录包含、位图扩展名与 8 MiB 上限校验，返回 data URI。绝对路径、`file:`、远程 URL、`..` 逃逸与目录外符号链接返回 `null`。预览有 5 秒/40 项缓存，避免选择变化重复读图。
7. **远程图片默认不自动加载。** `http(s)` 图片显示占位提示，不因打开文稿产生网络请求；这与本地优先/隐私边界一致。本地相对图片是主路径。
8. **外链由主进程放行。** 普通链接 `Ctrl/Cmd+点击`，表格内链接单击；渲染层只发起 IPC，主进程只接受 http/https，拒绝 `javascript:`、`file:`、`data:`、mailto、凭据 URL 与畸形值，再调用 `shell.openExternal`。
9. **CSP 不放宽到远程图片。** 生产 CSP 保持 `img-src 'self' data:`；本地图片以 data URI 显示，远程图片不获得隐式网络权限。

## 被否方案

- **直接把表格替换成 HTML 字符串并 `contenteditable=false`。** 会和 CodeMirror 的选区、撤销、输入法组合输入冲突；也容易产生第二份 DOM 内容模型。
- **用 ViewPlugin 提供 block decoration。** CodeMirror 明确抛出 “Block decorations may not be specified via plugins”。
- **渲染层直接用 `file://` 相对路径。** 生产 renderer 的页面 URL 不是文稿目录，且会把任意本地文件读取权限交给页面。
- **打开文稿就加载远程图片。** 会造成隐私泄漏、离线失败与不可控网络请求；本阶段不做。
- **把表格/图片做成可编辑富文本控件。** 需要另一套文档模型与输入法处理，超出 Phase 1 的可靠性与时间边界。

## 后果与边界

- 已验证：GFM 表格 HTML 渲染、点击回源码、光标离开后恢复表格；本地图片 data URI 加载、点击回源码；普通链接 Ctrl/Cmd+点击打开系统浏览器；`javascript:` 外链被拒绝并返回可读错误。
- 未覆盖：远程图片自动加载、图片缩放/平移、EXIF 方向、表格单元格内富文本编辑、超大文稿的虚拟化表格预览、Linux/IME 真机矩阵。
- 图片缓存按 5 秒 TTL，外部替换同一图片可能在短时间内显示旧图；重新打开文稿或切换预览可刷新。
- 表格 HTML 的远程图片仍受 CSP 限制，不会静默发起请求。

## 复现

```bash
npm run typecheck
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe \
  ./node_modules/vitest/vitest.mjs run
npm run stage -w @gather/desktop
# 打开含 GFM 表格、相对路径图片和 http(s) 链接的文稿
```

关键边界测试：

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe \
  ./node_modules/vitest/vitest.mjs run \
  packages/editor/test/live-preview.test.ts \
  apps/desktop/test/image-preview.test.ts \
  apps/desktop/test/external-links.test.ts
```
