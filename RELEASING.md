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

1. Update `package.json`, `server.json`, and `CHANGELOG.md`. Keep the npm package version, MCP server version, and npm package entry in sync.
2. Run:

   ```bash
   npm install --ignore-scripts
   npm run verify
   npm run smoke:pack
   ```

3. Commit and push the release changes.
4. Create and push the matching tag:

   ```bash
   git tag v1.5.0
   git push origin v1.5.0
   ```

The release workflow verifies that the tag matches `package.json`, installs and tests the packed artifact, publishes with npm provenance, and creates a GitHub Release.

If trusted publishing is not configured, use the manual fallback after authenticating locally:

```bash
npm login
npm whoami
npm publish --access public
git tag v1.5.0
git push origin v1.5.0
```

The tag workflow checks the registry first. When the matching version already exists, it skips the duplicate publish and creates only the GitHub Release.

Do not push the release tag until either npm trusted publishing is configured or the matching version has been published manually.

## Publish the MCP Registry entry

MCP Registry publication is separate from npm. Publish npm first so the registry can verify the matching package and `mcpName`, then authenticate and publish the root `server.json` with the official publisher:

```bash
mcp-publisher login github
mcp-publisher publish
```

The server name is `io.github.devrajsinh-jhala/npx-vibe`. Confirm the package appears in the registry before announcing registry installation; including metadata in the npm tarball does not publish the registry entry by itself.
