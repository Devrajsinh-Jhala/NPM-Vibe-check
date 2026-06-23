# Publishing npx-vibe

This project has two useful public surfaces:

1. the npm package, so friends can run `npx-vibe <package>`;
2. the static landing page in `site/`, so people can understand the idea quickly.

## 1. Create a GitHub repository

From this project folder:

```bash
git init
git add .
git commit -m "Initial npx-vibe release"
git branch -M main
git remote add origin https://github.com/Devrajsinh-Jhala/NPM-Vibe-check.git
git push -u origin main
```

If this folder is already a git repository, skip `git init`.

After the repo exists, update `package.json` with your actual repository URL:

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Devrajsinh-Jhala/NPM-Vibe-check.git"
  },
  "homepage": "https://Devrajsinh-Jhala.github.io/NPM-Vibe-check/",
  "bugs": {
    "url": "https://github.com/Devrajsinh-Jhala/NPM-Vibe-check/issues"
  }
}
```

## 2. Verify the npm package

```bash
npm run build
npm test
npm pack --dry-run
```

Also re-check that the package name is still available:

```bash
npm view npx-vibe name version
```

If npm returns `404 Not Found`, the name is still available.

## 3. Log in to npm

Create an npm account if you do not have one:

<https://www.npmjs.com/signup>

Then:

```bash
npm login
npm whoami
```

## 4. Publish

For the first public release:

```bash
npm publish
```

After publishing, test it from a clean directory:

```bash
npx npx-vibe --check is-number
npx npx-vibe --check esbuild
```

Users will usually run:

```bash
npx-vibe <package>
```

But for a package that has just been published, `npx npx-vibe ...` is the most reliable first smoke test.

## 5. Publish the landing page with GitHub Pages

The landing page lives in:

```text
site/
```

In GitHub:

1. Open the repository settings.
2. Go to **Pages**.
3. Set **Source** to **Deploy from a branch**.
4. Choose branch `main`.
5. Choose folder `/site`.
6. Save.

Your site should become available at:

```text
https://Devrajsinh-Jhala.github.io/NPM-Vibe-check/
```

## 6. Share it with friends

Short version:

```bash
npx npx-vibe --check esbuild
```

With online AI:

```bash
OPENAI_API_KEY=... npx npx-vibe --ai online esbuild
ANTHROPIC_API_KEY=... npx npx-vibe --ai online esbuild
GEMINI_API_KEY=... npx npx-vibe --ai online esbuild
```

With local Ollama:

```bash
npx npx-vibe --ai ollama --ollama-model qwen2.5-coder esbuild
```

## 7. Updating later

Patch release:

```bash
npm version patch
npm publish
git push --follow-tags
```

Minor release:

```bash
npm version minor
npm publish
git push --follow-tags
```
