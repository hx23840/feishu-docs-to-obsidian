# 飞书文档到 Obsidian

把飞书云文档导入 Obsidian，并把图片保存到本地 vault。

## 使用 BRAT 安装

插件还没有提交到 Obsidian 官方插件市场，当前推荐用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 安装。

1. 在 Obsidian 社区插件里安装并启用 `Obsidian42 - BRAT`。
2. 打开命令面板，执行 `BRAT: Add a beta plugin for testing`。
3. 粘贴这个仓库地址：

   ```text
   https://github.com/hx23840/feishu-docs-to-obsidian
   ```

4. 到 Obsidian 设置 -> Community plugins，启用 `飞书文档到 Obsidian`。

## 安装依赖：飞书 CLI

这个插件依赖飞书官方 CLI：[`lark-cli`](https://github.com/larksuite/cli)。如果你还没有安装，先在终端执行：

```bash
npx @larksuite/cli@latest install
```

首次使用还需要完成应用配置和登录授权：

```bash
lark-cli config init --new
lark-cli auth login --recommend
```

完成后验证能否读取飞书文档：

```bash
lark-cli docs +fetch --doc "https://your-domain.feishu.cn/docx/..." --format json
```

如果 Obsidian 找不到 `lark-cli`，在插件设置里把 `lark-cli path` 改成绝对路径，例如：

```text
/opt/homebrew/bin/lark-cli
```

这是一个桌面端 MVP 插件，底层复用官方 `lark-cli`：

1. 用 `lark-cli docs +fetch` 读取飞书文档。
2. 把飞书返回的 HTML-like 内容转换成 Markdown。
3. 用 `lark-cli docs +media-preview` 下载文档图片。
4. 把正文和图片写入 Obsidian vault。

## 功能

- 导入飞书 `docx` 或 `wiki` 链接。
- 自动下载图片到指定附件目录。
- 图片可用 Obsidian wiki link 或普通 Markdown link。
- 自动写入来源 frontmatter。
- 支持刷新当前已导入文档。

## 前置条件

- Obsidian 桌面端。
- 已安装并登录 [`lark-cli`](https://github.com/larksuite/cli)。

如果这里没有权限，插件里也不会有权限。插件不绕过飞书权限，只调用本机 `lark-cli`。

## 使用

命令面板里有两个命令：

- `飞书文档到 Obsidian: 导入飞书文档`
- `飞书文档到 Obsidian: 刷新当前飞书文档`

导入后的文档会带 frontmatter：

```yaml
---
feishu_source: "https://your-domain.feishu.cn/docx/..."
feishu_document_id: "..."
feishu_revision_id: 21
feishu_imported_at: "2026-06-25T00:00:00.000Z"
---
```

刷新命令只会在当前文件存在 `feishu_source` 时显示。

## 设置

- `lark-cli path`：默认 `lark-cli`。如果 Obsidian 找不到命令，填绝对路径，比如 `/opt/homebrew/bin/lark-cli`。
- `Note folder`：导入笔记保存目录，留空代表 vault 根目录。
- `Attachment folder`：图片保存目录。
- `Image link style`：Obsidian wiki link 或普通 Markdown link。
- `Overwrite existing files`：是否覆盖同名文件。

## 限制

- 仅桌面端可用。
- 依赖本机 `lark-cli` 登录态和飞书文档权限。
- 当前转换器覆盖常见块：标题、段落、列表、引用/callout、分割线、加粗/斜体、图片。
- 复杂表格、公式、附件、嵌入块后续可继续扩展。

## 许可证

Apache-2.0
