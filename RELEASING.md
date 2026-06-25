# Releasing npx-vibe

Releases are designed to publish from GitHub Actions with npm trusted publishing and provenance rather than a long-lived npm token.

## One-time npm setup

On the npm package settings page for `npx-vibe`, add a trusted publisher with:

- Provider: GitHub Actions
- Organization or user: `Devrajsinh-Jhala`
- Repository: `NPM-Vibe-check`
- Workflow filename: `release.yml`
- Environment: `npm`

The workflow lives at `.github/workflows/release.yml` and requests only `contents: write` and `id-token: write`.

## Prepare a release

1. Update `package.json` and `CHANGELOG.md`.
2. Run:

   ```bash
   npm install --ignore-scripts
   npm run verify
   npm run smoke:pack
   ```

3. Commit and push the release changes.
4. Create and push the matching tag:

   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```

The release workflow verifies that the tag matches `package.json`, installs and tests the packed artifact, publishes with npm provenance, and creates a GitHub Release.

Do not create or push the release tag until npm trusted publishing is configured for the workflow.
