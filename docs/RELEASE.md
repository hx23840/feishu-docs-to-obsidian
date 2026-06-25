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
4. Create a Git tag:

   ```bash
   git tag 0.1.0
   git push origin main --tags
   ```

5. Attach these files to the GitHub release:

   - `main.js`
   - `manifest.json`
   - `styles.css`

## Obsidian Community Plugin Submission

Before submission, verify:

- `manifest.json` has the final author and repository metadata.
- The repository is public.
- The README explains the `lark-cli` dependency clearly.
- No credentials or tokens are committed.
