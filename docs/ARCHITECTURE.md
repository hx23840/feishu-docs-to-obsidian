# Architecture

飞书文档到 Obsidian is intentionally split into a small desktop-only MVP.

## Runtime Boundary

The plugin does not implement Feishu authentication. It delegates all Feishu access to the local `lark-cli` binary.

```text
Obsidian command
  -> child_process.execFile(lark-cli)
  -> Feishu/Lark Open API through lark-cli
  -> JSON document payload
  -> Markdown converter
  -> Obsidian vault files
```

## Import Flow

1. User runs `导入飞书文档`.
2. Plugin prompts for a document URL.
3. Plugin executes:

   ```bash
   lark-cli docs +fetch --doc <url> --format json
   ```

4. Plugin reads `data.document.content`.
5. Plugin extracts image tokens from `<img ... src="TOKEN"/>`.
6. Plugin executes `docs +media-preview` for each image.
7. Plugin writes a Markdown note with frontmatter and local image links.

## Refresh Flow

`刷新当前飞书文档` is only available when the active note has `feishu_source` frontmatter.

The refresh operation re-runs the import flow and replaces the current file content.

## Converter Scope

The converter currently supports:

- title
- headings
- paragraphs
- unordered lists
- callouts
- dividers
- bold/italic
- images

Unsupported or partially supported blocks should be added as narrow converter tests before changing production behavior.
