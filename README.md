# npx-vibe

[![npm version](https://img.shields.io/npm/v/npx-vibe.svg?color=22d3ee)](https://www.npmjs.com/package/npx-vibe)
[![npm downloads](https://img.shields.io/npm/dw/npx-vibe.svg?color=34d399)](https://www.npmjs.com/package/npx-vibe)
[![Node.js](https://img.shields.io/node/v/npx-vibe.svg)](https://www.npmjs.com/package/npx-vibe)
[![License: MIT](https://img.shields.io/npm/l/npx-vibe.svg)](./LICENSE)

**npx-vibe** is a cautious `npx` wrapper that checks npm packages before they run on your machine.

It performs fast deterministic supply-chain checks first, then optionally escalates suspicious packages to local Ollama or an online AI provider for install-script review. The goal is simple: keep the convenience of `npx`, but add a visible safety pause before unknown package code executes.

- npm: [npmjs.com/package/npx-vibe](https://www.npmjs.com/package/npx-vibe)
- Website: [devrajsinh-jhala.github.io/NPM-Vibe-check](https://devrajsinh-jhala.github.io/NPM-Vibe-check/)
- GitHub: [Devrajsinh-Jhala/NPM-Vibe-check](https://github.com/Devrajsinh-Jhala/NPM-Vibe-check)

## Install

Run without installing globally:

```bash
npx npx-vibe --check esbuild
```

Or install once:

```bash
npm install -g npx-vibe
npx-vibe --check esbuild
```

Use it like `npx` when you actually want to execute a package:

```bash
npx npx-vibe cowsay -- hello from a safer npx
```

## Why this exists

Modern JavaScript workflows often ask developers to run packages directly from the registry:

```bash
npx some-new-cli
```

That is convenient, but risky. A package can include install hooks, obfuscated setup files, or suspicious network behavior before you have had a chance to inspect it. `npx-vibe` adds a pre-flight review step that checks the package metadata and tarball before execution.

## What it checks

| Area | Signals |
| --- | --- |
| Registry trust | package age, version publish age, weekly downloads, maintainers, publisher, license |
| Install behavior | `preinstall`, `install`, `postinstall`, `prepare`, setup files, shell usage |
| Tarball safety | downloads the npm tarball without executing package code, verifies registry integrity |
| Source signals | suspicious file names, environment variable access, network calls, encoded payloads |
| Repository context | GitHub repository, stars, latest commit, last push, repository freshness |
| AI review | optional Ollama or online model review for suspicious install-time code |

## Example output

```text
$ npx npx-vibe --check obscure-helper
✕ npx-vibe: Block  risk 92/100
obscure-helper@0.0.3
Fresh package with install-time credential access.

NPM updated: today  Version published: today
License: unknown  Maintainers: 1  Publisher: new-user
Repository: unknown
Downloads: 12/week
Install hooks: preinstall, postinstall
AI review: online model (high confidence)

Findings:
- CRITICAL possible_secret_exfiltration in setup.js
- CRITICAL download_and_execute in postinstall.js

Action: blocked unless --force is supplied.
```

Verdicts:

- **Proceed** — no meaningful risk signals found.
- **Caution** — suspicious or incomplete signals; review before executing.
- **Block** — high-risk behavior detected.

## Usage

```bash
npx-vibe [options] <package-spec> [-- package args]
```

Common commands:

```bash
# Review only, do not execute
npx npx-vibe --check <package>

# Print machine-readable JSON
npx npx-vibe --json <package>

# Review, then execute if allowed
npx npx-vibe <package> -- <package args>

# Disable AI completely
npx npx-vibe --ai off <package>
```

## AI review options

`npx-vibe` does not require AI. The default path is deterministic and fast.

```bash
npx npx-vibe --ai off <package>       # static checks only
npx npx-vibe --ai auto <package>      # use AI only when useful and configured
npx npx-vibe --ai ollama <package>    # local model through Ollama
npx npx-vibe --ai online <package>    # online provider
```

### Local Ollama

```bash
npx npx-vibe --ai ollama --ollama-model qwen2.5-coder <package>
```

### Online providers

Online mode is provider-agnostic. Use a provider-specific environment variable, or pass one key directly with `--api-key` / `NPX_VIBE_API_KEY`.

Auto-detected provider keys:

```bash
OPENAI_API_KEY=... npx npx-vibe --ai online <package>
ANTHROPIC_API_KEY=... npx npx-vibe --ai online <package>
GEMINI_API_KEY=... npx npx-vibe --ai online <package>
OPENROUTER_API_KEY=... npx npx-vibe --ai online <package>
GROQ_API_KEY=... npx npx-vibe --ai online <package>
TOGETHER_API_KEY=... npx npx-vibe --ai online <package>
```

Explicit provider examples:

```bash
npx npx-vibe --ai online --provider anthropic --api-key sk-ant-... <package>
npx npx-vibe --ai online --provider gemini --api-key AIza... <package>
npx npx-vibe --ai online --provider openrouter --api-key sk-or-... <package>
```

Custom OpenAI-compatible endpoint:

```bash
npx npx-vibe --ai online \
  --provider custom \
  --api-url https://models.example.com/v1/chat/completions \
  --api-key ... \
  --model your-model \
  <package>
```

Supported presets:

- `openai`
- `anthropic`
- `gemini`
- `openrouter`
- `groq`
- `together`
- `custom` / `openai-compatible`

## Privacy model

`npx-vibe` is designed to avoid leaking your local workspace.

It does **not** send these to AI providers:

- local project files
- npm tokens
- shell history
- your environment variables
- files outside the downloaded npm package tarball

When AI review is enabled, it sends only bounded package metadata, deterministic findings, install scripts, and selected files from the downloaded npm tarball.

## Exit codes

For `--check` and `--json`:

| Code | Meaning |
| --- | --- |
| `0` | Proceed |
| `1` | Operational error |
| `2` | Caution / incomplete review |
| `3` | Block |

In execution mode, a permitted package run exits with the child process exit code.

## Configuration

Environment variables:

```bash
NPX_VIBE_AI=auto
NPX_VIBE_PROVIDER=auto
NPX_VIBE_API_KEY=...
NPX_VIBE_API_URL=https://api.openai.com/v1/chat/completions
NPX_VIBE_MODEL=gpt-4.1-mini
NPX_VIBE_OLLAMA_URL=http://127.0.0.1:11434
NPX_VIBE_OLLAMA_MODEL=qwen2.5-coder
NPX_VIBE_AGE_DAYS=14
NPX_VIBE_DOWNLOADS=1000
NPX_VIBE_CAUTION_SCORE=40
NPX_VIBE_BLOCK_SCORE=70
```

Useful flags:

```bash
--check
--json
--yes
--force
--ai auto|off|online|ollama
--provider auto|openai|anthropic|gemini|openrouter|groq|together|custom
--model <name>
--api-key <key>
--api-url <url>
--ollama-url <url>
--ollama-model <name>
--registry <url>
--age-days <days>
--downloads <count>
--caution-score <0-100>
--block-score <0-100>
--allow-install-scripts
```

## Current scope

This MVP supports npm registry package specs, dist-tags, exact versions, and common semver ranges.

It intentionally rejects arbitrary tarball URLs, Git URLs, and local paths in v1. That keeps the trust boundary narrow and easier to reason about.

## Disclaimer

`npx-vibe` is a developer safety tool, not a guarantee that a package is safe. Treat `Proceed` as a useful signal, not a security proof. Always review high-risk packages manually before execution.

## License

MIT © Devrajsinh Jhala
