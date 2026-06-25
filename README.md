# Lark Docs to Obsidian

Import Feishu/Lark Docs into an Obsidian vault with local images.

This plugin is a desktop-only MVP that wraps the official `lark-cli` workflow:

1. Fetch a Feishu/Lark Docs document with `lark-cli docs +fetch`.
2. Convert the returned document content to Markdown.
3. Download document images with `lark-cli docs +media-preview`.
4. Save the note and images inside your vault.

## Features

- Import a Feishu/Lark Docs `docx` or `wiki` link into a Markdown note.
- Download images into a configurable vault attachment folder.
- Render images as Obsidian wiki links or portable Markdown links.
- Add source metadata in frontmatter.
- Refresh the current imported note from its original Feishu URL.

## Requirements

- Obsidian desktop.
- Node.js, only for development/building the plugin.
- [`lark-cli`](https://github.com/larksuite/cli) installed and authenticated.

The plugin does not handle Feishu authentication itself. It calls your local `lark-cli`, so access is controlled by the CLI login/session on your machine.

## Quick Start

First make sure `lark-cli` can read your document from a terminal:

```bash
lark-cli docs +fetch --doc "https://your-domain.feishu.cn/docx/..." --format json
```

If that works, install this plugin in your vault:

```bash
cd /path/to/your/vault/.obsidian/plugins
git clone <repository-url> lark-docs-to-obsidian
cd lark-docs-to-obsidian
npm install
npm run build
```

Then enable `Lark Docs to Obsidian` from Obsidian Settings -> Community plugins.

## Usage

Open the command palette and run:

- `Lark Docs to Obsidian: Import Lark/Feishu document`
- `Lark Docs to Obsidian: Refresh current Lark/Feishu document`

Imported notes include frontmatter like:

```yaml
---
feishu_source: "https://your-domain.feishu.cn/docx/..."
feishu_document_id: "..."
feishu_revision_id: 21
feishu_imported_at: "2026-06-25T00:00:00.000Z"
---
```

`Refresh current Lark/Feishu document` only appears when the active file has `feishu_source` frontmatter.

## Settings

- `lark-cli path`: defaults to `lark-cli`. Use an absolute path if Obsidian cannot find it, for example `/opt/homebrew/bin/lark-cli`.
- `Note folder`: where imported notes are created. Empty means vault root.
- `Attachment folder`: where images are saved.
- `Image link style`: Obsidian wiki links or Markdown links.
- `Overwrite existing files`: replace existing images/notes when paths match.

## Development

```bash
npm install
npm run dev
```

For local development, clone the repository directly into:

```text
<your-vault>/.obsidian/plugins/lark-docs-to-obsidian
```

Then reload Obsidian and enable the plugin.

## Release

Build the plugin:

```bash
npm run build
```

Release artifacts are:

- `main.js`
- `manifest.json`
- `styles.css`

## Privacy

This plugin sends document URLs and media tokens only to your local `lark-cli` process. It does not send data to any service other than the Feishu/Lark APIs that `lark-cli` calls.

Imported document content and images are stored in your local Obsidian vault.

## Limitations

- Desktop only. Mobile Obsidian cannot reliably execute `lark-cli`.
- Requires a working `lark-cli` login and document permissions.
- The converter targets common Feishu doc blocks: headings, paragraphs, lists, callouts, dividers, bold/italic, and images.
- Complex tables, equations, embedded files, and advanced blocks may need follow-up support.

## References

- [Obsidian plugin developer documentation](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [larksuite/cli](https://github.com/larksuite/cli)

## License

MIT
