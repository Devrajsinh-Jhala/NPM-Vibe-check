# Changelog

All notable changes to `npx-vibe` are documented here.

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
