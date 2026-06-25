# Feishu Docs to Obsidian

[Chinese](./README.zh.md)

Import Feishu Docs into an Obsidian vault with local images.

## Install With BRAT

This plugin is not in the Obsidian Community Plugins directory yet. The recommended installation path is [BRAT](https://github.com/TfTHacker/obsidian42-brat).

1. Install and enable `Obsidian42 - BRAT` from Obsidian Community Plugins.
2. Open the command palette and run `BRAT: Add a beta plugin for testing`.
3. Paste this repository URL:

   ```text
   https://github.com/hx23840/feishu-docs-to-obsidian
   ```

4. Enable this plugin from Obsidian Settings -> Community plugins.

## Dependency: Feishu CLI

This plugin depends on the official Feishu/Lark CLI: [`lark-cli`](https://github.com/larksuite/cli). If you have not installed it yet, run:

```bash
npx @larksuite/cli@latest install
```

For first-time use, configure the Feishu app and log in:

```bash
lark-cli config init --new
lark-cli auth login --recommend
```

Then verify that `lark-cli` can read your Feishu document:

```bash
lark-cli docs +fetch --doc "https://your-domain.feishu.cn/docx/..." --format json
```

If Obsidian cannot find `lark-cli`, open the plugin settings and set `lark-cli path` to the absolute path, for example:

```text
/opt/homebrew/bin/lark-cli
```

This plugin is a desktop-only MVP that wraps the official `lark-cli` workflow:

1. Fetch a Feishu Docs document with `lark-cli docs +fetch`.
2. Convert the returned document content to Markdown.
3. Download document images with `lark-cli docs +media-preview`.
4. Save the note and images inside your vault.

## Features

- Import a Feishu `docx` or `wiki` link into a Markdown note.
- Download images into a configurable vault attachment folder.
- Render images as Obsidian wiki links or portable Markdown links.
- Add source metadata in frontmatter.
- Refresh the current imported note from its original Feishu URL.

## Requirements

- Obsidian desktop.
- Node.js, only for development/building the plugin.
- [`lark-cli`](https://github.com/larksuite/cli) installed and authenticated.

The plugin does not handle Feishu authentication itself. It calls your local `lark-cli`, so access is controlled by the CLI login/session on your machine.

## Usage

After installation, click the import icon in the left ribbon and paste a Feishu `docx` or `wiki` URL when prompted. The import dialog stays open and shows the current step, final note path, image count, or error message.

You can also open the command palette and run the import command.

For an imported note, open that note and run the refresh command to fetch the latest source content again.

Imported notes also show a refresh action in the file context menu.

Imported notes include frontmatter like:

```yaml
---
feishu_source: "https://your-domain.feishu.cn/docx/..."
feishu_document_id: "..."
feishu_revision_id: 21
feishu_imported_at: "2026-06-25T00:00:00.000Z"
---
```

The refresh command is available only when the active file has `feishu_source` frontmatter.

## Settings

- `lark-cli path`: defaults to `lark-cli`. Use an absolute path if Obsidian cannot find it, for example `/opt/homebrew/bin/lark-cli`.
- `Note folder`: where imported notes are created. Empty means vault root.
- `Attachment folder`: root folder for images. Each imported document gets its own title-based subfolder.
- `Image link style`: Obsidian wiki links or Markdown links.
- `Overwrite existing files`: replace existing images/notes when paths match.

## Development

For local development, clone the repository directly into your vault:

```bash
cd /path/to/your/vault/.obsidian/plugins
git clone https://github.com/hx23840/feishu-docs-to-obsidian
cd feishu-docs-to-obsidian
```

Then install dependencies and build:

```bash
npm install
npm run dev
```

The local development path should be:

```text
<your-vault>/.obsidian/plugins/feishu-docs-to-obsidian
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

This plugin sends document URLs and media tokens only to your local `lark-cli` process. It does not send data to any service other than the Feishu APIs that `lark-cli` calls.

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

Apache-2.0
