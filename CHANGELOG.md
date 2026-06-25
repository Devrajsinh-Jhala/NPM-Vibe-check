# Changelog

All notable changes to `npx-vibe` are documented here.

## 1.1.1 - 2026-06-25

### Fixed

- Recognize Google's new Gemini authorization-key format when `--api-key` is used with automatic provider selection.
- Send Gemini credentials through the current `x-goog-api-key` header instead of a URL query parameter.
- Refuse to forward unrecognized direct API keys to a guessed provider.
- Redact exact API keys from provider error bodies before displaying them.

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
