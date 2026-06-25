# Release

## Manual Release

1. Update `package.json` version.
2. Run:

   ```bash
   npm run version
   npm run build
   npm audit
   ```

3. Commit the version bump.
4. Create and push a Git tag:

   ```bash
   git tag v0.1.0
   git push origin main --tags
   ```

5. GitHub Actions will create a release and attach these files:

   - `main.js`
   - `manifest.json`
   - `styles.css`

BRAT installs the plugin from these release assets.

## Obsidian Community Plugin Submission

Before submission, verify:

- `manifest.json` has the final author and repository metadata.
- The repository is public.
- The README explains the `lark-cli` dependency clearly.
- No credentials or tokens are committed.
