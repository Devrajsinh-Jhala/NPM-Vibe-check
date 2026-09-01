# Changelog

All notable changes to `npx-vibe` are documented here.

## 2.1.0 - 2026-09-02

### Added

- A GitHub Action, so a workflow needs one step instead of a hand-written npx
  invocation. It runs `project`, `approve-scripts`, or `package`, exposes
  `verdict` and `exit-code` outputs, and takes a `fail-on` policy of `block`
  (default), `caution`, or `never`. An incomplete scan fails the step under every
  policy, because a scan that could not finish is not a pass.
- The action verifies which npx-vibe actually ran. npx prefers a locally
  resolvable binary of the same name, so a project pinning npx-vibe as a
  devDependency could silently run that version instead; a mismatch is now a
  clear error rather than a confusing one.
- `approve-scripts --ci` writes a job summary table to `GITHUB_STEP_SUMMARY`,
  matching what project scans already did.

## 2.0.0 - 2026-09-01

A security scanner should default to not running code, should score behaviour
rather than novelty, and should not lose accuracy because a constant went stale.
All three required breaking changes.

### Breaking

- **Scanning is the default; execution moved to `npx-vibe run`.** `npx-vibe <pkg>`
  now reviews and exits. `npx-vibe run <pkg> -- args` scans and then executes,
  and remains the only command that runs anything. `--yes`, `--force`,
  `--allow-install-scripts`, and package arguments after `--` are rejected
  outside `run`. `--check` is still accepted as a no-op so existing CI keeps
  working.
- **Project scans are transitive by default.** `--direct-only` restores the old
  behaviour. Compromises reach victims through the tree, not the four names in
  package.json. Without a lockfile the scan degrades to direct dependencies and
  says so, instead of failing.
- **Registry context no longer scores.** `young_package`, `young_version`,
  `low_downloads`, and `downloads_unavailable` moved to a new `info` severity
  that is reported and never scored. They fired on every healthy release --
  vite, zod, svelte and turbo among them -- and trained people to ignore output.
- **The bundled model catalog is gone.** `--model` (or `NPX_VIBE_MODEL`) is now
  required for online AI review, and `--model-profile` is removed. A pinned id
  that a provider retires turned into a 404, then `ai_unavailable`, then a
  floored score, and finally a false Caution. `--models` now lists providers,
  their key variables, and where each publishes its current model list.
- **Agent `schemaVersion` is 2.** The `info` severity, the transitive default,
  and the `script-approvals` kind all change how a payload must be read.
- **MCP: `list_models` became `list_providers`**, `scan_project` takes
  `directOnly` instead of `transitive`, and `modelProfile` is gone from every
  tool schema.

### Added

- `npx-vibe approve-scripts` and the matching `approve_scripts` MCP tool: review
  every dependency npm would let run an install script and return approve,
  review, or deny with the source line behind it. `--write` records only the
  unambiguous decisions in `allowScripts`; anything needing review is left for a
  person. Reads package-lock.json, so it works on npm 10 and 11 as well as 12.
- OSV.dev known-vulnerability lookup, batched across a whole tree, no API key.
  An advisory tops out at high severity and never forces a Block on its own.
  `--no-advisories` skips it.

### Fixed

- `npx-vibe run` works on Windows. Node refuses to spawn npm's `.cmd` shim
  without a shell, so execution failed with `spawn EINVAL`. npm's JavaScript
  entry point is now run directly with the current node binary, which needs no
  shell and keeps arguments out of a command-line parser.

## 1.6.0 - 2026-08-31

### Fixed

- A critical `possible_secret_exfiltration` finding no longer fires on any environment read plus any network signal in the same file. The two must now be part of the same code path, appear in an install script, or sit in an install-related file. Unrelated matches are reported as a low `env_access_and_network` finding instead. This hard-Blocked vite, rollup, and npm-check-updates on fragments hundreds of lines apart, and a critical finding is unrecoverable because it short-circuits the verdict ahead of any AI review.
- Bare URLs no longer count as network activity for `network_and_shell` or as an escalation for `obfuscated_code`. Every `package.json` carries a repository URL, so the signal was always present.
- The shell environment-dump pattern is anchored to a command boundary and requires a pipe or redirect. It previously matched `offset|0` and `charset>` in ordinary JavaScript.
- `prepare`, `prepublish`, `preprepare`, and `postprepare` are reported as `publish_lifecycle_hook` at low severity. npm does not run them when a published tarball is installed, so they no longer raise Caution or spend an AI call.
- A dependency's own `devDependencies` and `peerDependencies` are no longer checked for unusual protocols. npm never installs them for the consumer.
- Request timeouts now cover the response body. The abort timer was cleared as soon as headers arrived, leaving every body read untimed and unbounded.
- Tarball downloads are streamed with a 100 MiB cap, and decompression is bounded by `maxOutputLength` instead of being checked after the fact.
- Review memory is written through a temp file and rename, so concurrent project scans cannot read a half-written file. The rename also enforces `0600` on every write.
- The selected-file byte budget is enforced. It was computed and then discarded, so only the file count ever limited what was reviewed.
- Version ranges resolve to stable releases unless the range names a prerelease. `^1.0.0` could resolve to `1.3.0-beta.1` over a published `1.2.0`.
- Weekly download counts for a project scan are fetched through npm's bulk endpoint. One request per package rate-limited partway through a large scan and produced spurious `downloads_unavailable` findings.
- MCP requests are dispatched concurrently, bounded at four. A long `scan_project` previously blocked every later request, including `ping`.
- An MCP `package` argument beginning with `-` is rejected instead of being reinterpreted as a command-line flag.

### Added

- `--transitive` and the MCP `transitive` argument scan every registry-resolved package in `package-lock.json`, not only the direct dependencies. Workspace links, git resolutions, and non-registry protocols stay outside the trust boundary.
- `--max-packages` (default 500, `NPX_VIBE_MAX_PACKAGES`) caps one project scan. Packages past the cap are reported as skipped.
- The dashboard reports review coverage: files read only in part, files left past the review budget, and publish hooks that npm does not run on install.
- `GITHUB_TOKEN`, `GH_TOKEN`, or `NPX_VIBE_GITHUB_TOKEN` raises the GitHub metadata rate limit, which unauthenticated CI runners exhaust quickly.

### Changed

- The default Anthropic `max_tokens` is 4000, so a full findings array is not truncated into invalid JSON.
- The HTTP user agent is read from `package.json` rather than a hardcoded version string.

## 1.5.1 - 2026-07-13

### Fixed

- Match the MCP Registry identifier to the canonical, case-sensitive GitHub namespace granted during publisher authentication.

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
