# Contributing

Thanks for considering a contribution.

## Development

```bash
npm install
npm run dev
```

Place the repository in an Obsidian vault under:

```text
.obsidian/plugins/feishu-docs-to-obsidian
```

Then enable the plugin in Obsidian.

## Pull Requests

- Keep changes focused.
- Run `npm run build` before opening a pull request.
- Include a short manual test note for import/refresh behavior when changing importer logic.

## Scope

The current goal is a reliable desktop workflow backed by `lark-cli`.

Good follow-up areas:

- More Feishu block conversions.
- Better table support.
- Conflict-aware refresh.
- Direct Open API mode.
