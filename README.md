# npx-vibe

`npx-vibe` is a lightweight safety wrapper for running packages from the npm registry.

Instead of:

```bash
npx obscure-package
```

run one-off:

```bash
npx npx-vibe obscure-package
```

Or install globally once:

```bash
npm install -g npx-vibe
npx-vibe obscure-package
```

It resolves the exact package version, checks npm registry risk signals, downloads the tarball without executing package code, inspects install hooks and suspicious files, optionally asks an AI reviewer, and then prints a terminal verdict:

- `Proceed`
- `Caution`
- `Block`

The dashboard also shows useful package context: npm updated date, version publish date, license, maintainers, repository, GitHub stars, last push, and latest commit when the package links to a public GitHub repo.

## Quick start

```bash
npx npx-vibe <package>
npx npx-vibe --check <package>
npx npx-vibe --json <package>
```

By default, `npx-vibe` runs deterministic checks and uses AI only when available.

AI modes:

```bash
npx npx-vibe --ai off <package>
npx npx-vibe --ai auto <package>
npx npx-vibe --ai online <package>
npx npx-vibe --ai ollama <package>
```

## Online AI providers

Online mode is provider-agnostic. You can either use a provider-specific environment variable, or pass one key directly with `--api-key` / `NPX_VIBE_API_KEY`.

Auto-detected provider keys:

```bash
OPENAI_API_KEY=... npx npx-vibe --ai online <package>
ANTHROPIC_API_KEY=... npx npx-vibe --ai online <package>
GEMINI_API_KEY=... npx npx-vibe --ai online <package>
OPENROUTER_API_KEY=... npx npx-vibe --ai online <package>
GROQ_API_KEY=... npx npx-vibe --ai online <package>
TOGETHER_API_KEY=... npx npx-vibe --ai online <package>
```

Explicit provider:

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

Supported provider presets:

- `openai`
- `openai-compatible` / `custom`
- `anthropic`
- `gemini`
- `openrouter`
- `groq`
- `together`

## Local Ollama

```bash
npx npx-vibe --ai ollama --ollama-model qwen2.5-coder <package>
```

## Privacy model

`npx-vibe` never sends your local project files, npm token, shell history, or environment variables to the model.

When AI review is enabled, it sends only bounded package metadata, deterministic findings, install scripts, and selected package files from the downloaded npm tarball.

## Exit codes

For `--check` and `--json`:

- `0`: Proceed
- `1`: operational error
- `2`: Caution / incomplete review
- `3`: Block

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
```

## Current scope

This MVP supports npm registry package specs, tags, exact versions, and common semver ranges.

It intentionally rejects arbitrary tarball URLs, Git URLs, and local paths in v1.