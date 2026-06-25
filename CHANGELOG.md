# Changelog

## 0.1.2

- Keep the import dialog open while an import is running.
- Show import progress, final note path, image count, and error messages in the dialog.
- Improve the import dialog input layout.
- Correctly update an existing note when overwrite mode targets an existing path.

## 0.1.1

- Add a left ribbon icon for importing Feishu documents.
- Add a file menu refresh action for imported notes.

## 0.1.0

- Initial desktop-only Obsidian plugin.
- Import Feishu documents through local `lark-cli`.
- Convert common Feishu document blocks to Markdown.
- Download images into the vault with `docs +media-preview`.
- Add refresh support through `feishu_source` frontmatter.
