# npx-vibe

[![npm version](https://img.shields.io/npm/v/npx-vibe.svg?color=22d3ee)](https://www.npmjs.com/package/npx-vibe)
[![npm weekly downloads](https://img.shields.io/npm/dw/npx-vibe.svg?color=34d399)](https://www.npmjs.com/package/npx-vibe)
[![npm total downloads](https://img.shields.io/npm/dt/npx-vibe.svg?color=a78bfa)](https://www.npmjs.com/package/npx-vibe)
[![CI](https://github.com/Devrajsinh-Jhala/NPM-Vibe-check/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/Devrajsinh-Jhala/NPM-Vibe-check/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/npx-vibe.svg)](https://www.npmjs.com/package/npx-vibe)
[![License: MIT](https://img.shields.io/npm/l/npx-vibe.svg)](./LICENSE)

**Evidence-first safety checks for npm packages and project dependencies before developers, coding agents, or MCP clients execute them.**

`npx-vibe` resolves packages from the public npm registry, downloads and verifies their tarballs without executing them, inspects install-time code, and prints clear **Proceed**, **Caution**, or **Block** verdicts. Use it for one-off `npx` commands or scan an existing project's direct dependencies.

The default scan is deterministic, local, and requires no account or API key. AI review is optional, opt-in, and lets you choose an exact model or a maintained `fast`, `balanced`, or `strong` profile. Version 1.5 also ships a zero-dependency MCP server with read-only package, project, and model-catalog tools.

- [npm package](https://www.npmjs.com/package/npx-vibe)
- [Official MCP Registry entry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Devrajsinh-Jhala%2Fnpx-vibe)
- [Live website](https://devrajsinh-jhala.github.io/NPM-Vibe-check/)
- [GitHub repository](https://github.com/Devrajsinh-Jhala/NPM-Vibe-check)
- [Security policy](./SECURITY.md)
- [Changelog](./CHANGELOG.md)
- [Release process](./RELEASING.md)

## Live adoption

The [project website](https://devrajsinh-jhala.github.io/NPM-Vibe-check/) displays the current seven-day download total directly from npm's public download API:

- [weekly total](https://api.npmjs.org/downloads/point/last-week/npx-vibe)
- [daily seven-day range](https://api.npmjs.org/downloads/range/last-week/npx-vibe)

The counter is live rather than hard-coded, and the site links to the source data. npm download counts measure package fetches, not unique users. They are momentum signals—not proof of package safety or quality—but they show that the package is being discovered and installed.

## Quick start

Review a package without executing it:

```bash
npx npx-vibe esbuild
```

Use it as a guarded replacement for `npx`:

```bash
npx npx-vibe cowsay -- hello from npx-vibe
```

Or install the command globally:

```bash
npm install -g npx-vibe
npx-vibe <package>
```

Scan an existing project's direct dependencies:

```bash
npx npx-vibe --project .
```

Give a coding agent a stable, read-only result:

```bash
npx --yes npx-vibe@latest --agent esbuild
npx --yes npx-vibe@latest --agent --project .
```

Or connect the native MCP server:

```bash
npx --yes npx-vibe@latest --mcp
```

## Use npx-vibe with coding agents

`--agent` turns the scanner into a predictable machine interface. It implies check-only mode, writes only JSON to stdout, disables terminal color and local review-memory writes, and never executes package code. Operational failures are JSON too, so an agent can fail closed instead of interpreting partial terminal output.

Install the portable Agent Skill for Codex, Claude Code, Cursor, VS Code, and other compatible agents:

```bash
npx skills add Devrajsinh-Jhala/NPM-Vibe-check --skill npx-vibe -g
```

The skill tells an agent to preflight unfamiliar packages before `npx`, `npm exec`, or dependency installation and then apply the normalized decision:

| `decision.action` | Required behavior |
| --- | --- |
| `continue` | Continue only with the package action the user already requested |
| `review` | Pause, summarize source evidence, and request human approval |
| `stop` | Do not install or execute the package |
| `retry` | The scan is incomplete; report the error and do not infer safety |

Example envelope:

```json
{
  "schemaVersion": 2,
  "tool": { "name": "npx-vibe", "version": "2.0.0" },
  "kind": "package-scan",
  "status": "complete",
  "decision": {
    "verdict": "caution",
    "riskScore": 43,
    "action": "review",
    "exitCode": 2,
    "mayContinue": false,
    "safeToExecute": false,
    "requiresApproval": true,
    "requiresHumanReview": true,
    "blocked": false,
    "mustStop": false
  },
  "subject": {
    "type": "package",
    "name": "esbuild",
    "requested": "latest",
    "version": "0.28.1"
  },
  "report": {}
}
```

The complete deterministic report remains under `report`. Require `schemaVersion === 2`, `status === "complete"`, and `decision.mayContinue === true` before continuing automatically. The outer `npx --yes` only suppresses npm's download prompt; agent mode rejects npx-vibe's execution flags such as `--force` and `--yes`.

AI remains off by default in agent mode. If a user explicitly requests model interpretation, use a provider-specific environment variable and add `--ai online --provider <provider>`; never place a key in a generated command.

## Connect npx-vibe through MCP

Version 1.5 includes a read-only [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio. It gives MCP-compatible AI applications a native tool surface without teaching them to parse terminal text or construct shell commands.

Add this server configuration to an MCP client that supports local stdio servers:

```json
{
  "mcpServers": {
    "npx-vibe": {
      "command": "npx",
      "args": ["--yes", "npx-vibe@latest", "--mcp"]
    }
  }
}
```

Global installations can use `npx-vibe-mcp` as the command with no arguments. Run `npx npx-vibe --mcp --help` for server-specific help.

The server exposes four schema-backed tools:

| MCP tool | Purpose |
| --- | --- |
| `scan_package` | Resolve, verify, and inspect one public npm package without executing it |
| `scan_project` | Review the dependency tree from a project manifest and lockfile |
| `approve_scripts` | Decide which dependencies may run install scripts under npm 12 |
| `list_providers` | Return supported AI providers and where each publishes its model list |

Scan results return the same versioned decision contract in both `structuredContent` and a JSON text block for client compatibility. The tools are annotated read-only and non-destructive. `review` still requires human approval, while `stop`, `retry`, and MCP tool errors fail closed.

AI remains off unless a tool call explicitly selects it. API keys are intentionally excluded from MCP tool arguments: configure provider-specific environment variables on the MCP server process so credentials do not enter prompts or tool history.

`npx-vibe@2.0.0` is [active in the official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Devrajsinh-Jhala%2Fnpx-vibe) as `io.github.Devrajsinh-Jhala/npx-vibe`. Registry clients can resolve the verified npm package and start its local stdio server with `--mcp`.

## Why developers use it

Running `npx some-package` can download code and execute a package binary immediately. Packages may also declare lifecycle scripts that run during installation.

`npx-vibe` inserts a visible checkpoint before execution:

1. Resolve the exact npm package version.
2. Fetch registry, download, maintainer, publisher, and repository context.
3. Download the tarball without running package code.
4. Verify npm integrity metadata and inspect bounded source files.
5. Show matched evidence and a risk verdict.
6. Execute only after the verdict allows it.

For an existing app, `--project` repeats the same read-only review across direct registry dependencies and aggregates the result. This makes the check useful in local development and pull-request CI, not only before an unfamiliar `npx` command.

By default, execution uses npm with install scripts ignored. Use `--allow-install-scripts` only when you intentionally want reviewed root lifecycle scripts to run.

## Evidence, not mystery scores

Every deterministic source finding includes the matched line and a bounded excerpt. Registry popularity is displayed separately as context and never overrides suspicious code. Local review memory is keyed by the verified package integrity—not merely its name or version. The example below mirrors a real scan; registry dates and download counts naturally change over time.

```text
$ npx npx-vibe esbuild
! npx-vibe: Caution  risk 43/100
esbuild@0.28.1

Downloads: 241,858,907/week  Package age: 3132d  Version age: 12d
Install hooks: postinstall
Established signals: long registry history, high weekly adoption, linked GitHub repository
Registry popularity and age provide context, but never override code findings.
Review memory: unchanged tarball since 2026-06-25; previous Caution 43/100.
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

When AI is explicitly enabled, the resolved provider and model are visible in the result. This example is adapted from the successful Gemini 3.5 Flash run on June 25, 2026; model wording can vary:

```text
$ npx npx-vibe --ai online --provider gemini --model gemini-3.5-flash esbuild
! npx-vibe: Caution  risk 43/100
esbuild@0.28.1

Install hooks: postinstall
AI review: Gemini gemini-3.5-flash (high confidence)
AI evidence: 0 source-backed findings

AI interpretation: The selected install script appears to resolve a platform-specific binary.
No additional source-backed credential access, obfuscation, or persistence finding was
identified, but the deterministic install-time network and process evidence remains.

Action: review recommended before execution.
```

## What it checks

| Area | Signals |
| --- | --- |
| Known vulnerabilities | OSV.dev advisories for the exact resolved version, with CVE aliases and severity. No API key; batched across a whole tree |
| Registry context | package age, version age, weekly downloads, maintainers, publisher, license, deprecation. Reported, never scored |
| Install behavior | `preinstall`, `install`, `postinstall`, and their script targets. `prepare`, `prepublish`, `preprepare`, and `postprepare` are reported separately as context, because npm does not run them when a published tarball is installed |
| Tarball safety | npm integrity verification, unsafe paths, escaping symlinks, archive size and entry limits |
| Source behavior | secret/environment access, network calls, shell execution, external payloads, obfuscation, persistence, mining indicators |
| Dependency metadata | remote Git/HTTP/file protocols in the fields npm actually installs, and lockfile install-script indicators |
| Repository context | GitHub repository, stars, last update, last push, and latest commit |
| Review memory | verified integrity match, previous verdict, selected-file changes, lifecycle-hook changes, and finding deltas |
| Optional AI | local Ollama or supported online providers, used only after explicit opt-in and a heuristic trigger |

## Built for repeated use

`npx-vibe` always performs a fresh registry lookup, tarball download, integrity verification, and deterministic scan. Local review memory adds comparison context after those checks:

```text
Review memory: unchanged tarball since 2026-06-25; previous Caution 43/100.
```

When the integrity changes:

```text
Version comparison: 0.28.1 → current; integrity changed.
2 selected files changed; findings +1/-0; install hooks unchanged.
```

The history file stores package versions, integrity hashes, selected-file hashes, finding identifiers, verdicts, and model metadata. It does not store package source, API keys, environment values, or local project files. The default location is `~/.npx-vibe/reviews.json`.

## Verdicts

| Verdict | Meaning | Check-mode exit code |
| --- | --- | --- |
| **Proceed** | No meaningful deterministic risk signal was found | `0` |
| **Caution** | Reviewable behavior or incomplete context requires human judgment | `2` |
| **Block** | Critical behavior or a high-risk review result was detected | `3` |
| Operational error | Registry, network, input, or internal failure | `1` |

Registry context — package age, version age, and download volume — is reported at the `info` severity and never contributes to the score. It describes how new a package is, not whether it does anything.

A verdict is a decision aid, not proof that a package is safe or malicious.

## Usage

```text
npx-vibe [options] <package-spec>                      # scan a package
npx-vibe run [options] <package-spec> [-- arguments]   # scan, then execute
npx-vibe approve-scripts [options] [--write]           # settle npm 12 allowScripts
npx-vibe --project <directory|package.json> [options]  # scan a dependency tree
npx-vibe --mcp
```

Scanning never executes package code. `npx-vibe run` is the only command that
does, and it still refuses a Block verdict unless you pass `--force`.

Common commands:

```bash
# Scan a package; nothing is executed
npx npx-vibe <package>

# Machine-readable output
npx npx-vibe --json <package>

# Versioned, fail-closed JSON for coding agents
npx --yes npx-vibe@latest --agent <package>

# Review, then execute when permitted
npx npx-vibe run <package> -- <arguments>

# Select one executable from a package with multiple binaries
npx npx-vibe run --bin tsc typescript -- --version

# Decide which dependencies may run install scripts under npm 12
npx npx-vibe approve-scripts
npx npx-vibe approve-scripts --write

# Scan production and optional dependencies from this project
npx npx-vibe --project .

# Scan only the direct dependencies named in package.json
npx npx-vibe --project . --direct-only

# Include direct development dependencies
npx npx-vibe --project . --include-dev

# Machine-readable project report
npx npx-vibe --project . --json

# Agent-ready project report
npx --yes npx-vibe@latest --agent --project .

# Start the MCP server over stdio
npx --yes npx-vibe@latest --mcp

# Execute a Caution verdict without prompting
npx npx-vibe run --yes <package>

# Execute a Block verdict intentionally
npx npx-vibe run --force <package>
```

Useful options:

```text
--json
--agent
--mcp
--project <path>
--include-dev
--direct-only
--max-packages <1-5000>
--no-advisories
--ci
--concurrency <1-8>
--ai-limit <0-100>
--yes, -y
--force
--bin <name>
--ai off|auto|online|ollama
--provider auto|openai|anthropic|gemini|openrouter|groq|together|custom
--models
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
--no-history
--history-file <path>
--check                     (deprecated; scanning is the default and this is a no-op)
--no-color
```

Run `npx npx-vibe --help` for the complete CLI reference.

## Project dependency scans

Project mode turns the one-package review into a repeatable dependency preflight:

```bash
npx npx-vibe --project .
```

It reads `package.json` and, when present, `package-lock.json` locally. Exact versions from npm lockfiles are preferred over version ranges. By default it scans direct `dependencies` and `optionalDependencies`; add `--include-dev` for `devDependencies`.

Every registry-resolved package in `package-lock.json` is reviewed, not only the direct ones, because supply-chain compromises usually arrive transitively. Pass `--direct-only` for the narrower, faster check:

```bash
npx npx-vibe --project . --direct-only
```

Without a lockfile the scan degrades to direct dependencies and says so, rather than failing.

```text
! npx-vibe project: Caution  highest risk 43/100
my-app@1.0.0

Scanned: 12/12 direct dependencies  Proceed: 11  Caution: 1  Block: 0
Scope: dependencies + optionalDependencies
Resolution: exact versions from package-lock.json when available
AI review: off (heuristic-only)

Packages:
- CAUTION  43/100  esbuild@0.28.1
  young_version, lifecycle_hook, network_and_shell

No dependency or package code was executed during this project scan.
Action: review the flagged dependencies and their evidence individually.
```

The workflow is deliberately bounded:

- The whole installed tree from `package-lock.json` is scanned by default. `--direct-only` narrows it to the dependencies named in `package.json`.
- `--max-packages` (default 500) caps how many packages one scan reviews. Anything past the cap is reported as skipped, never silently dropped.
- Workspace, local, alias, URL, and Git specs are reported as skipped rather than uploaded or resolved through another trust path.
- Heuristic-only scans use three concurrent reviews by default (`--concurrency 1-8`). Weekly download counts for the whole scan are fetched through npm's bulk endpoint in a single request.
- If AI is opted in, reviews are sequential and only heuristic-triggered packages call the model. The default budget is three calls (`--ai-limit 0-100`).
- `package.json` and `package-lock.json` are never sent to an AI provider. Optional online AI receives only bounded files selected from the downloaded registry package.

This is autonomous triage rather than autonomous execution: discover, resolve, verify, inspect, escalate when requested, and aggregate. It never installs dependencies or edits the project.

## AI is optional and opt-in

Ambient keys such as `OPENAI_API_KEY` or `GEMINI_API_KEY` do **not** activate AI in the default mode.

> **Important:** Do not paste long-lived API keys into screenshots, issues, chat messages, or shared terminal recordings. Revoke any exposed key immediately.

```bash
npx npx-vibe <package>                         # heuristic-only default
npx npx-vibe --provider gemini --api-key <key> <package>  # direct-key shortcut
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

Provider-specific environment variables are the safest and most reliable option because they avoid provider guessing and keep secrets out of shell history. Recognizable direct-key formats can be routed automatically, but ambiguous formats stop locally and ask for `--provider` rather than sending a credential to a guessed service.

Google introduced new Gemini authorization keys in June 2026. `npx-vibe 1.2.0` recognizes both the newer authorization-key family and traditional Google API keys, and sends Gemini credentials using Google's documented `x-goog-api-key` header.

PowerShell example:

```powershell
$env:GEMINI_API_KEY="<new-key>"
npx npx-vibe --ai online --provider gemini esbuild
Remove-Item Env:GEMINI_API_KEY
```

Direct-key example when you intentionally want to specify the provider:

```powershell
npx npx-vibe --provider gemini --api-key "<new-key>" esbuild
```

If automatic routing cannot confidently identify a direct key, `npx-vibe` exits locally with instructions to add `--provider`. It does not try the key against OpenAI or any other guessed endpoint.

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

AI findings are checked against the inspected source before they are displayed as evidence. A model finding records its file, line, exact excerpt, and rationale. Unsupported model claims are omitted from the source-backed findings section, and an unsupported AI recommendation cannot independently produce a Block verdict.

### Naming the model is required

`npx-vibe` ships **no model catalog**. A pinned model id rots: when a provider retires one, the call fails, the review becomes `ai_unavailable`, the score is floored, and the package reports a **false Caution**. A scanner whose accuracy decays on a timer is worse than one that asks you to name the model.

```bash
npx npx-vibe --ai online --provider anthropic --model <id> <package>
npx npx-vibe --ai online --provider gemini --model <id> <package>
```

`--models` lists every supported provider, the environment variable it reads its key from, and where that provider publishes its current model list:

```bash
npx npx-vibe --models
```

Official model lists: [OpenAI](https://platform.openai.com/docs/models), [Anthropic](https://docs.anthropic.com/en/docs/about-claude/models), [Gemini](https://ai.google.dev/gemini-api/docs/models), [OpenRouter](https://openrouter.ai/models), [Groq](https://console.groq.com/docs/models), and [Together](https://docs.together.ai/docs/serverless-models).

Local models need no key and keep their own default:

```bash
npx npx-vibe --ai ollama --ollama-model qwen2.5-coder <package>
```

## Automation, agents, and CI

Use JSON plus exit codes in local automation:

```bash
npx npx-vibe --json <package> > npx-vibe-report.json
npx npx-vibe --project . --json > npx-vibe-project-report.json
```

Use the versioned agent envelope when another tool or coding agent owns the decision loop:

```bash
npx --yes npx-vibe@latest --agent <package>
npx --yes npx-vibe@latest --agent --project .
```

Agent mode keeps stdout machine-readable for successful, incomplete, and failed scans. It is deliberately incompatible with `--force`, npx-vibe's `--yes`, `--allow-install-scripts`, and package execution arguments.

For GitHub Actions, `--ci` emits a warning for each Caution result, an error for each Block or operational failure, and writes a package table to the job summary:

```yaml
name: Dependency preflight

on:
  pull_request:
  workflow_dispatch:

jobs:
  npx-vibe:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx --yes npx-vibe@2.0.0 --project . --include-dev --ci
```

Project mode preserves the normal exit contract: `0` Proceed, `2` Caution, `3` Block, and `1` for an incomplete scan caused by an operational error. `--ci` and `--json` are intentionally separate so JSON output remains valid.

The repository tests Node.js 20, 22, and 24 across Linux, Windows, and macOS. CI also packs the npm tarball, installs it into a clean temporary consumer project, and exercises the shipped CLI and MCP handshake from the exact artifact users receive.

The tag-driven release workflow is prepared for [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and `npm publish --provenance`. Configure the trusted publisher once, then push a version tag to publish without storing a long-lived npm token. See [RELEASING.md](./RELEASING.md).

## Configuration

```bash
NPX_VIBE_AI=off
NPX_VIBE_PROVIDER=auto
NPX_VIBE_API_KEY=...
NPX_VIBE_API_URL=https://api.openai.com/v1/chat/completions
NPX_VIBE_MODEL=                # required for online AI review
NPX_VIBE_HISTORY=on
NPX_VIBE_HISTORY_FILE=~/.npx-vibe/reviews.json
NPX_VIBE_OLLAMA_URL=http://127.0.0.1:11434
NPX_VIBE_OLLAMA_MODEL=qwen2.5-coder
NPX_VIBE_AGE_DAYS=14
NPX_VIBE_DOWNLOADS=1000
NPX_VIBE_CAUTION_SCORE=40
NPX_VIBE_BLOCK_SCORE=70
NPX_VIBE_CONCURRENCY=3
NPX_VIBE_AI_LIMIT=3
NPX_VIBE_MAX_PACKAGES=500
NPX_VIBE_ADVISORIES=on         # "off" skips the OSV lookup
GITHUB_TOKEN=                # optional; raises the GitHub metadata rate limit
```

## Supported scope

`npx-vibe` supports public npm registry package names, scoped packages, dist-tags, exact versions, common semver ranges, and dependency discovery from npm package manifests and lockfiles, including the full transitive tree with `--transitive`. Version ranges resolve to stable releases unless the range itself names a prerelease, matching npm. It intentionally rejects local paths, arbitrary tarball URLs, Git URLs, and non-registry project dependencies to keep the trust boundary narrow.

Node.js 20 or newer is required. The project is tested on current Windows, macOS, and Linux GitHub-hosted runners.

## Security boundary

`npx-vibe` is a pre-execution risk scanner. It is not a sandbox, antivirus engine, formal audit, or guarantee of safety. A package may hide behavior in unselected files, runtime branches, native code, or remote responses.

Review coverage is bounded and reported rather than implied. Files are selected from the install and executable entry points and the imports reachable from them; each selected file is read up to 64 KiB, and the scan stops selecting once the byte budget is reached. The dashboard names how many files were read only in part or left past the budget, so a large bundled file is never mistaken for a fully reviewed one.

- Treat **Proceed** as a useful signal, not proof.
- Read the evidence for **Caution** findings.
- Do not bypass **Block** unless you understand the behavior.
- Report vulnerabilities privately through [SECURITY.md](./SECURITY.md).
- Report noisy findings with the [false-positive template](https://github.com/Devrajsinh-Jhala/NPM-Vibe-check/issues/new?template=false-positive.yml).

## Contributing

Contributions that improve detection quality, evidence, compatibility, or false-positive handling are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT © Devrajsinh Jhala
