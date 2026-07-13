# Changelog

All notable changes to `npx-vibe` are documented here.

## 1.5.0 - 2026-07-13

### Added

- A zero-runtime-dependency MCP server over stdio, available through `npx-vibe --mcp` and the dedicated `npx-vibe-mcp` binary.
- Schema-backed `scan_package`, `scan_project`, and `list_models` MCP tools with read-only annotations and structured output.
- Fail-closed MCP errors, bounded message handling, credential-safe AI opt-in, and compatibility with stable MCP protocol revisions through `2025-11-25`.
- MCP Registry-ready `server.json` metadata and the matching npm `mcpName` package identifier.
- Packed-artifact smoke coverage for MCP initialization and tool discovery.

### Changed

- The portable Agent Skill now prefers native MCP tools when connected and keeps the versioned `--agent` CLI as a fallback.
- Documentation and the landing page now explain both the Agent Skill and MCP integration paths.
- The automated test suite now covers 63 package, project, provider, output, history, agent-contract, and MCP behaviors.

## 1.4.0 - 2026-07-13

### Added

- `--agent` emits a versioned, non-interactive JSON envelope for package and project scans, including a normalized `continue`, `review`, `stop`, or `retry` action.
- Agent mode fails closed on incomplete scans, returns operational failures as JSON, disables terminal color and local review-memory writes, and rejects execution-oriented flags.
- A portable `npx-vibe` Agent Skill teaches compatible coding agents to preflight unfamiliar npm packages and pause for human review on Caution results.
- `site/llms.txt` provides concise agent-readable product, command, and decision-contract documentation.
- Packed-install smoke coverage now validates the shipped agent contract.

### Changed

- Agent integration documentation now covers package scans, project scans, stable exit codes, safe AI opt-in, and Skills CLI installation.
- The landing page now includes a dedicated coding-agent workflow, animated agent demo, and interactive Agent JSON report.
- The automated test suite now covers 55 package, project, provider, output, history, and agent-contract behaviors.

## 1.3.0 - 2026-07-13

### Added

- `--bin <name>` selects a specific executable from packages that expose multiple binaries, with actionable validation when the name is unavailable.
- `--project <path>` scans direct registry dependencies from an existing `package.json` without executing dependency or package code.
- Lockfile-aware resolution uses exact direct versions from npm `package-lock.json` v1-v3 when available.
- `--include-dev` adds `devDependencies` to project scans; production and optional dependencies remain the default scope.
- `--ci` emits GitHub Actions warnings/errors and writes a Markdown job summary.
- `--concurrency` controls key-free heuristic scan concurrency, while `--ai-limit` bounds triggered AI reviews and avoids surprise project-scan costs.

### Changed

- Project scans skip workspace, local, alias, URL, and Git dependencies explicitly instead of crossing the registry-only trust boundary.
- Project scans omit per-package GitHub API enrichment to remain fast and avoid unauthenticated rate limits.
- Concurrent scans merge integrity-keyed review history safely instead of allowing stale writers to drop another package's record.
- Common semver ranges using `||` are now resolved correctly.
- Packed-install smoke tests now exercise the shipped project-scan workflow.
- The tag-driven release workflow detects versions already published manually, preventing duplicate npm publish failures while still creating the GitHub Release.

## 1.2.0 - 2026-06-25

### Added

- Integrity-keyed local review memory that recognizes unchanged tarballs without skipping fresh verification or scanning.
- Version comparison for changed selected files, lifecycle hooks, and deterministic finding deltas.
- Source matching for AI findings, including file, line, exact evidence, and rationale.
- Packed-tarball installation smoke tests that exercise the CLI users actually receive.
- A tag-driven npm trusted-publishing workflow with provenance and generated GitHub Releases.
- A release runbook for configuring npm OIDC publishing safely.

### Changed

- Unsupported AI claims can no longer independently elevate a package to Block.
- The terminal reports source-backed AI coverage and omits unsupported AI findings from the evidence section.
- AI prompts forbid unsupported claims about package identity, publisher legitimacy, or cryptographic behavior.
- The landing page now leads with workflow proof, the real Gemini review, repeat-use memory, release assurance, and an explicit privacy data flow.
- Version bumped to `1.2.0`.

## 1.1.1 - 2026-06-25

### Fixed

- Recognize Google's new Gemini authorization-key format when `--api-key` is used with automatic provider selection.
- Send Gemini credentials through the current `x-goog-api-key` header instead of a URL query parameter.
- Refuse to forward unrecognized direct API keys to a guessed provider.
- Redact exact API keys from provider error bodies before displaying them.
- Reduce structured provider failures to concise, actionable one-line messages.

## 1.1.0 - 2026-06-25

### Added

- `fast`, `balanced`, and `strong` model profiles for every supported online provider.
- `--models` to inspect the bundled provider/model mapping without an API key or network request.
- Exact model overrides through `--model`, with explicit model requirements for custom compatible endpoints.
- AI-review examples and current model guidance in the README and landing page.

### Changed

- Replaced retired model defaults with provider-specific recommendations verified on June 25, 2026.
- The default `balanced` profile now favors current, cost-conscious models suitable for package review.
- AI output identifies the resolved provider, model, and profile.
- Provider failures are concise and retain the attempted model context.
- Landing-page terminal demos and responsive alignment were redesigned around heuristic and AI workflows.

## 1.0.1 - 2026-06-24

### Added

- Live weekly npm download counter and seven-day trend chart sourced from npm's public API.
- Custom SVG favicon and improved momentum visuals on the landing page.
- Graceful last-known fallback when npm's download API is slow or unavailable.

### Changed

- Terminal demos now mirror current real scans for `is-number` and `esbuild`.
- The Block demo is explicitly identified as a synthetic malicious test fixture.
- README now links to live adoption data and includes weekly and total download badges.

## 1.0.0 - 2026-06-24

### Added

- Line-level evidence excerpts for deterministic source findings.
- Registry trust context that distinguishes package maturity from code behavior.
- Cross-platform CI for Node.js 20, 22, and 24 on Linux, Windows, and macOS.
- Security policy, contribution guide, false-positive template, and release verification command.

### Changed

- AI review is heuristic-only by default and never activates from ambient provider keys.
- Passing `--api-key` or `NPX_VIBE_API_KEY` explicitly enables online AI review.
- The terminal, README, and landing page now explain evidence and security boundaries more clearly.
- npm publishing now runs build and tests automatically.

## 0.1.1 - 2026-06-23

- Professional npm metadata, README, provider support, rich package profiles, and landing-page polish.

## 0.1.0 - 2026-06-23

- Initial public release.
