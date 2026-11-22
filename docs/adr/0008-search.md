# ADR 0008：单文件查找替换使用 CodeMirror 搜索状态

- 状态：Accepted
- 日期：2026-11-22
- 范围：`packages/editor`、`apps/desktop`

## 背景

编辑器此前只注册了 `searchKeymap`，没有安装 `search()` 状态扩展，也没有界面入口。用户需要在一个文稿内查找、替换、全部替换和关闭面板，同时不能引入另一套文本模型或破坏撤销栈。

## 决策

1. **使用 CodeMirror 官方 search 扩展。** `search({ top: true })` 提供查询状态、匹配高亮、正则/大小写/整词选项与替换 transaction；Markdown 源文本仍是唯一数据。
2. **面板中文文案。** 通过 `EditorState.phrases.of` 把 Find/Replace/next/previous/replace all 等短语映射为中文，不 fork 搜索包。
3. **快捷键与入口统一。** `Ctrl/Cmd+F` 打开查找（搜索框聚焦），`Ctrl/Cmd+H` 打开同一面板并聚焦/选中替换框；菜单与工具栏调用同一命令。
4. **替换走原生事务。** `replaceAll` 由 CodeMirror 在一个 transaction 中完成，Undo 使用既有 history 扩展恢复原文；没有自定义字符串拼接或 DOM 直改。
5. **面板关闭不破坏内容。** Escape 关闭面板；查询/替换值保持在搜索状态，重新打开时恢复。
6. **不把搜索扩展到工作区。** 首版只处理当前打开文稿；工作区级结果列表、跨文件替换、搜索历史和固定搜索选项留到后续。

## 被否方案

- **自己写 textarea 搜索条和 replaceAll。** 会重复处理选区、正则、全词、撤销和多选区，容易与 CodeMirror 的 history/装饰冲突。
- **用浏览器 `window.find`。** 不受 CodeMirror 文档模型控制，替换会绕过撤销栈。
- **只保留 searchKeymap。** 没有 `search()` 扩展，面板没有状态可挂载，快捷键无法可靠工作。
- **默认英文面板。** 产品其余 UI 为中文；通过 phrases 覆盖即可，无需要维护 fork。

## 后果与边界

- 已验证：真实窗口 `Ctrl+F` 打开中文面板；搜索 `Gather` 高亮 7 处；`Ctrl+H` 聚焦替换；全部替换更新正文；Ctrl+Z 恢复原文；Escape 关闭面板；工具栏/菜单入口可见。
- 面板包含区分大小写、正则、整词开关，但本批只做了可见性与基本替换验收，未逐项组合跑矩阵。
- 工作区级搜索、结果计数、搜索历史、固定选项和跨文件替换未实现。
- 搜索基于 CodeMirror 可见文档模型；20 MiB 文件上限仍适用。

## 复现

```bash
npm run stage -w @gather/desktop
# 打开含重复词的文稿
# Ctrl+F 输入 Gather；Ctrl+H 输入替换词；全部替换；Ctrl+Z
```

真实窗口截图：`docs/images/gather-search.png`。
