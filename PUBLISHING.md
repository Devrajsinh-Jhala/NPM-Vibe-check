# Publishing the final release

Version 3.0.0 is the final planned release. Do not reuse published npm or MCP Registry versions.

## Package and registry

Follow [RELEASING.md](RELEASING.md) for the trusted GitHub Actions publishing workflow, verification, and the separate MCP Registry publication. Package metadata, server metadata, documentation, and demos must agree on the version and schema.

A passkey is not a six-digit authenticator OTP. Prefer the established trusted publishing workflow; for a manual publish, use npm's current browser authentication flow rather than repeatedly guessing OTPs.

## Landing page

The static site lives in `site/` and is served from the `gh-pages` branch. Deploy a commit containing the site tree only, preserving the existing deployment branch history. Do not force-push or overwrite unrelated branch changes.

Deploy after npm 3.0.0 is available so the installation examples resolve. Verify the homepage, styles, JavaScript, animations, guide, favicon, and llms.txt on the public URL.

## Final checks

```bash
npm view npx-vibe version mcpName
npx --yes npx-vibe@3.0.0 --version
npx --yes npx-vibe@3.0.0 --agent is-number@7.0.0
```

Confirm npm, GitHub Release, MCP Registry version, website, and CI independently. A source push does not by itself publish npm or the MCP Registry. Ending maintenance does not require unpublishing releases or archiving the repository.
