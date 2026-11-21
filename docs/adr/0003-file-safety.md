# ADR 0003：文稿写入、字节保真与冲突拒绝

- 状态：Accepted（Phase 1）
- 日期：2026-11-21
- 决策者：Gather maintainers
- 相关：ADR 0001（桌面壳）、ADR 0002（编辑器核心）、ADR 0004（恢复快照与 watcher）

## 背景

Gather 的承诺是“文件留在磁盘，作者做最后决定”。Phase 0 已经做到临时文件 + `rename`，但仍有三个会导致用户不信任编辑器的问题：

1. CodeMirror 内部使用 LF。直接写回会悄悄把 CRLF 文件改成 LF，并丢掉 UTF-8 BOM。
2. 打开文件后，另一个程序可能改写同一路径。后保存者会无提示覆盖前者。
3. 打开新文件只做一次全文替换，撤销栈可能把上一篇文稿恢复回来。

这三项都属于“不能靠文档提醒用户小心”的数据安全问题，必须在进入 beta 前用可测试的机制解决。

## 决策

### 1. 格式与编辑文本分离

`@gather/core/text-format` 负责纯字符串转换：

- `decodeText(raw)` 返回 `{ text, format }`；`text` 始终是 LF，BOM 被剥离。
- `format` 记录 `{ bom, eol }`，`eol` 为 `lf`、`crlf` 或 `mixed`。
- `encodeText(text, format)` 在保存时恢复 BOM 与纯 CRLF。
- `normalizeTextFormat` 校验跨 IPC 的格式对象，非法值回退到 LF、无 BOM。

规则：

| 原文件 | 编辑器内 | 保存结果 |
| --- | --- | --- |
| 纯 LF | LF | 纯 LF，逐字节不变 |
| 纯 CRLF | LF | 纯 CRLF，逐字节不变 |
| BOM + 纯 CRLF | LF，BOM 不入正文 | BOM + CRLF 恢复 |
| 混合 CRLF/LF 或孤立 CR | LF | 统一为 LF，界面提示“混合行尾” |
| 无结尾换行 | 保留 | 不擅自补换行 |

混合行尾无法在“一个文档级 eol 字段”下逐行保真，因此明确选择“保存时统一为 LF”，并在打开状态与页脚显示格式，而不是假装保真。

### 2. 读取时记录版本指纹

主进程读取原始字节，并返回：

- `mtimeMs`：展示与诊断用；
- `size`：原始字节数；
- `digest`：原始字节的 SHA-256。

读取前检查 20 MiB 上限；使用 `isUtf8` 拒绝无效 UTF-8，检测 UTF-16 BOM 与 NUL，避免把二进制静默替换成 U+FFFD。打开后的 `content` 不含 BOM，行尾为 LF。

### 3. 保存使用乐观并发控制

保存请求携带打开时的 `mtimeMs`、`size`、`digest` 与格式。主进程执行：

1. 校验编辑文本与格式，按原格式编码；
2. 检查目标仍存在、是普通文件、未超过上限；
3. 读取目标字节，比较 `size` 与 SHA-256；不一致直接返回冲突；
4. 在目标目录创建独占临时文件，写入并 `fsync`；
5. 关闭临时文件后再次比较目标指纹，进一步缩小竞态窗口；
6. `rename` 覆盖目标，返回新的 `mtimeMs`、`size`、`digest`；
7. 任一步失败都清理临时文件；冲突时原文件保持不动。

只比较 mtime 会在复制、同步工具保留时间戳时误判，因此以内容 SHA-256 为主，mtime 仅作为元数据。二次检查不能消灭所有 TOCTOU，但把窗口缩到极小；真正的跨平台文件锁不在 Phase 1 范围。

### 4. 冲突交互

渲染层保留打开时的文件版本。保存被拒绝时：

- 不清除脏状态；
- 显示横幅，明确“未覆盖原文件”；
- 提供“另存为…”与“重新打开”；
- 不允许静默重试覆盖。

另存为不要求旧版本指纹，因为用户在系统保存对话框中已确认目标路径；但写入仍走同一套 UTF-8 校验、原子写入与格式恢复。

### 5. 打开新文件重建编辑器状态

不能只 dispatch 一次全文替换，也不能依赖 `history` Compartment 重配来清历史。`documentVersion` 变化时，编辑器用同一组扩展重建 `EditorState`：

- 撤销栈、选区、滚动与插件状态全部重置；
- 新文稿从位置 0 开始；
- 重建不触发 `onChange`，不会把打开动作误标为编辑。

## 代价与约束

- 每次保存多一次完整读取与 SHA-256，最大 20 MiB；这是可接受的本地成本。
- 临时文件与目标同目录，要求目录可写；只读目录会失败且不覆盖原文件。
- rename 后文件权限为新临时文件的权限（POSIX 为 0600）；尚未保留原文件 mode/owner。
- 混合行尾只能统一，不能逐行保真；未来若需要，必须引入行级元数据或明确拒绝编辑。
- 没有实时 watcher：外部修改只在保存时被拒绝，不会主动提示或合并。
- 没有自动保存/崩溃恢复；强杀进程仍可能丢失未保存编辑。

## 验证

- `packages/core/test/text-format.test.ts`：LF、CRLF、BOM、无结尾换行、混合行尾、跨 IPC 校验。
- `apps/desktop/test/file-io.test.ts`：真实临时目录 round-trip、外部修改拒绝、文件删除拒绝、Save As、混合行尾归一。
- Windows 生产窗口手工验证：
  - BOM + CRLF 文稿保存后 42 字节逐字节一致；
  - 编辑上一篇后打开新文件，Ctrl+Z 不会回到上一篇；
  - 外部改写后保存被拒绝，外部内容保留；“另存为”成功恢复；
  - CDP 确认 `file://` 响应带 CSP，内联脚本被 `script-src-elem` 阻止。
- CI：Ubuntu/Windows Node 24 执行 `npm ci`、typecheck、test、build、CLI `doctor`。

## 未解决

- 自动保存、崩溃恢复、备份：已在 [ADR 0004](0004-recovery-and-watcher.md) 实现恢复快照与实时 watcher。
- 实时外部变更提示与合并：提示已由 ADR 0004 实现；逐段合并未实现。
- 原文件权限/所有者保留。
- 文件锁与网络文件系统语义。
- frontmatter/表格/HTML 块的 golden corpus。
