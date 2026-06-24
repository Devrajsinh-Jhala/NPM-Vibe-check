# Publishing npx-vibe

This repository publishes two surfaces:

1. the `npx-vibe` npm package;
2. the static landing page from `site/` to the `gh-pages` branch.

## Release checklist

1. Confirm the working tree contains only intended changes.
2. Update `CHANGELOG.md` and the version in `package.json`.
3. Run the complete local verification:

```powershell
npm run verify
npm pack --dry-run
node bin/npx-vibe.js --check is-number
node bin/npx-vibe.js --check esbuild
```

4. Commit and push the source release to `master`.
5. Publish the landing page:

```powershell
git subtree push --prefix site origin gh-pages
```

6. Publish npm using a fresh authenticator code:

```powershell
npm publish --access public --otp=<current-6-digit-code>
```

The `prepublishOnly` script automatically runs syntax checks and tests before npm uploads the package.

## Post-publish checks

```powershell
npm view npx-vibe version
npx npx-vibe@latest --version
npx npx-vibe@latest --check is-number
```

Verify:

- npm: https://www.npmjs.com/package/npx-vibe
- site: https://devrajsinh-jhala.github.io/NPM-Vibe-check/
- CI: https://github.com/Devrajsinh-Jhala/NPM-Vibe-check/actions

## Versioning

Use semantic versioning:

- patch: compatible fixes and detection tuning;
- minor: compatible capabilities or new checks;
- major: intentionally changed defaults, output contracts, or execution behavior.

Never reuse a version already published to npm.
