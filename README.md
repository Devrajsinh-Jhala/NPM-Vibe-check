# npx-vibe

[![npm version](https://img.shields.io/npm/v/npx-vibe.svg?color=22d3ee)](https://www.npmjs.com/package/npx-vibe)
[![npm weekly downloads](https://img.shields.io/npm/dw/npx-vibe.svg?color=34d399)](https://www.npmjs.com/package/npx-vibe)
[![npm total downloads](https://img.shields.io/npm/dt/npx-vibe.svg?color=a78bfa)](https://www.npmjs.com/package/npx-vibe)
[![CI](https://github.com/Devrajsinh-Jhala/NPM-Vibe-check/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/Devrajsinh-Jhala/NPM-Vibe-check/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/npx-vibe.svg)](https://www.npmjs.com/package/npx-vibe)
[![License: MIT](https://img.shields.io/npm/l/npx-vibe.svg)](./LICENSE)

**Evidence-first safety checks for npm packages before `npx` executes them.**

`npx-vibe` resolves a package from the public npm registry, downloads and verifies its tarball without executing it, inspects install-time code, and prints a clear **Proceed**, **Caution**, or **Block** verdict.

The default scan is deterministic, local, and requires no account or API key. AI review is optional and opt-in.

- [npm package](https://www.npmjs.com/package/npx-vibe)
- [Live website](https://devrajsinh-jhala.github.io/NPM-Vibe-check/)
- [GitHub repository](https://github.com/Devrajsinh-Jhala/NPM-Vibe-check)
- [Security policy](./SECURITY.md)
- [Changelog](./CHANGELOG.md)

## Live adoption

The [project website](https://devrajsinh-jhala.github.io/NPM-Vibe-check/#momentum) displays the current seven-day download total and daily trend directly from npm's public download API:

- [weekly total](https://api.npmjs.org/downloads/point/last-week/npx-vibe)
- [daily seven-day range](https://api.npmjs.org/downloads/range/last-week/npx-vibe)

The counter is live rather than hard-coded, and the site links to the source data. npm download counts are adoption signals—not proof of package safety or quality—but they help show that real developers are trying the tool.

## Quick start

Review a package without executing it:

```bash
npx npx-vibe --check esbuild
```

Use it as a guarded replacement for `npx`:

```bash
npx npx-vibe cowsay -- hello from npx-vibe
```

Or install the command globally:

```bash
npm install -g npx-vibe
npx-vibe --check <package>
```

## Why developers use it

Running `npx some-package` can download code and execute a package binary immediately. Packages may also declare lifecycle scripts that run during installation.

`npx-vibe` inserts a visible checkpoint before execution:

1. Resolve the exact npm package version.
2. Fetch registry, download, maintainer, publisher, and repository context.
3. Download the tarball without running package code.
4. Verify npm integrity metadata and inspect bounded source files.
5. Show matched evidence and a risk verdict.
6. Execute only after the verdict allows it.

By default, execution uses npm with install scripts ignored. Use `--allow-install-scripts` only when you intentionally want reviewed root lifecycle scripts to run.

## Evidence, not mystery scores

Every deterministic source finding includes the matched line and a bounded excerpt. Registry popularity is displayed separately as context and never overrides suspicious code. The example below mirrors a real `npx-vibe 1.0.0` scan; registry dates and download counts naturally change over time.

```text
$ npx npx-vibe --check esbuild
! npx-vibe: Caution  risk 43/100
esbuild@0.28.1

Downloads: 241,858,907/week  Package age: 3132d  Version age: 12d
Install hooks: postinstall
Established signals: long registry history, high weekly adoption, linked GitHub repository
Registry popularity and age provide context, but never override code findings.
AI review: skipped (Heuristic-only mode; AI was not requested.)

Findings:
- MEDIUM   lifecycle_hook in package.json
  postinstall runs: node install.js
  Evidence: postinstall: node install.js
- MEDIUM   network_and_shell in install.js
  Code combines network access with shell execution.
  Evidence line 147: fetch(url) ... child_process.execSync(...)

Action: review recommended before execution.
```

A popular package can still receive **Caution** when it performs sensitive install-time behavior. That is intentional: maturity is useful context, not a security exemption.

## What it checks

| Area | Signals |
| --- | --- |
| Registry context | package age, version age, weekly downloads, maintainers, publisher, license, deprecation |
| Install behavior | `preinstall`, `install`, `postinstall`, `prepare`, and related script targets |
| Tarball safety | npm integrity verification, unsafe paths, escaping symlinks, archive size and entry limits |
| Source behavior | secret/environment access, network calls, shell execution, external payloads, obfuscation, persistence, mining indicators |
| Dependency metadata | remote Git/HTTP/file dependency protocols and lockfile install-script indicators |
| Repository context | GitHub repository, stars, last update, last push, and latest commit |
| Optional AI | local Ollama or supported online providers, used only after explicit opt-in and a heuristic trigger |

## Verdicts

| Verdict | Meaning | Check-mode exit code |
| --- | --- | --- |
| **Proceed** | No meaningful deterministic risk signal was found | `0` |
| **Caution** | Reviewable behavior or incomplete context requires human judgment | `2` |
| **Block** | Critical behavior or a high-risk review result was detected | `3` |
| Operational error | Registry, network, input, or internal failure | `1` |

A verdict is a decision aid, not proof that a package is safe or malicious.

## Usage

```text
npx-vibe [options] <package-spec> [-- package arguments]
```

Common commands:

```bash
# Heuristic-only review; do not execute
npx npx-vibe --check <package>

# Machine-readable output
npx npx-vibe --json <package>

# Review, then execute when permitted
npx npx-vibe <package> -- <arguments>

# Execute a Caution verdict without prompting
npx npx-vibe --yes <package>

# Execute a Block verdict intentionally
npx npx-vibe --force <package>
```

Useful options:

```text
--check
--json
--yes, -y
--force
--ai off|auto|online|ollama
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
--no-color
```

Run `npx npx-vibe --help` for the complete CLI reference.

## AI is optional and opt-in

Ambient keys such as `OPENAI_API_KEY` or `GEMINI_API_KEY` do **not** activate AI in the default mode.

```bash
npx npx-vibe <package>                         # heuristic-only default
npx npx-vibe --api-key <key> <package>         # online AI shortcut
npx npx-vibe --ai online <package>             # use an explicitly configured online provider
npx npx-vibe --ai auto <package>               # detect configured provider or local Ollama
npx npx-vibe --ai ollama <package>             # local Ollama
```

Provider-specific keys are read only after `--ai online` or `--ai auto` is selected:

```bash
OPENAI_API_KEY=... npx npx-vibe --ai online <package>
ANTHROPIC_API_KEY=... npx npx-vibe --ai online <package>
GEMINI_API_KEY=... npx npx-vibe --ai online <package>
OPENROUTER_API_KEY=... npx npx-vibe --ai online <package>
GROQ_API_KEY=... npx npx-vibe --ai online <package>
TOGETHER_API_KEY=... npx npx-vibe --ai online <package>
```

Custom OpenAI-compatible endpoint:

```bash
npx npx-vibe --ai online \
  --provider custom \
  --api-url https://models.example.com/v1/chat/completions \
  --api-key <key> \
  --model <model> \
  <package>
```

Online AI receives bounded package metadata, deterministic findings, install scripts, and selected files from the downloaded package tarball. It does not receive your project files, shell history, npm tokens, or environment-variable values.

## Automation and CI

Use JSON plus exit codes in CI or local automation:

```bash
npx npx-vibe --json <package> > npx-vibe-report.json
```

The repository tests Node.js 20, 22, and 24 across Linux, Windows, and macOS. npm publishing automatically runs syntax checks and the complete test suite through `prepublishOnly`. The interactive website demo labels real scans and synthetic malicious fixtures separately.

## Configuration

```bash
NPX_VIBE_AI=off
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

## Supported scope

`npx-vibe` supports public npm registry package names, scoped packages, dist-tags, exact versions, and common semver ranges. It intentionally rejects local paths, arbitrary tarball URLs, and Git URLs to keep the trust boundary narrow.

Node.js 20 or newer is required. The project is tested on current Windows, macOS, and Linux GitHub-hosted runners.

## Security boundary

`npx-vibe` is a pre-execution risk scanner. It is not a sandbox, antivirus engine, formal audit, or guarantee of safety. A package may hide behavior in unselected files, dependencies, runtime branches, native code, or remote responses.

- Treat **Proceed** as a useful signal, not proof.
- Read the evidence for **Caution** findings.
- Do not bypass **Block** unless you understand the behavior.
- Report vulnerabilities privately through [SECURITY.md](./SECURITY.md).
- Report noisy findings with the [false-positive template](https://github.com/Devrajsinh-Jhala/NPM-Vibe-check/issues/new?template=false-positive.yml).

## Contributing

Contributions that improve detection quality, evidence, compatibility, or false-positive handling are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT © Devrajsinh Jhala
