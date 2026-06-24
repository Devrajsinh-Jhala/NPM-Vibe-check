# Contributing to npx-vibe

Thanks for helping make package execution safer and less noisy.

## Development

Requirements: Node.js 20 or newer.

```bash
npm install --ignore-scripts
npm run verify
node bin/npx-vibe.js --check is-number
node bin/npx-vibe.js --check esbuild
```

Preview the landing page with:

```bash
npm run site:preview
```

## What makes a useful change

- A security rule should include a focused test and evidence that explains the match.
- False-positive fixes should generalize from behavior, not hard-code trust for a package name.
- Network-facing features should fail safely and preserve heuristic-only operation.
- User-facing behavior changes should update the README, help output, and changelog.

## Pull requests

Keep changes focused, describe the security or usability trade-off, and include before/after CLI output when changing findings or verdicts. Run `npm run verify` before opening a pull request.

## Reporting false positives

Use the false-positive issue template and include the exact package version, command, finding code, and redacted output. Never include API keys or npm tokens.
