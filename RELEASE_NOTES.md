# npx-vibe 3.0.0 — explicit coverage, pinned permissions

This is a breaking release, not just a version bump. It closes gaps where a partial project review could look like a successful gate and where an install-script permission could outlive the version actually reviewed.

## Breaking changes

- **Schema 3 for agents and MCP.** Results now include subject coverage. `decision.safeToExecute` has been removed. Continue only on a complete result with complete requested coverage and `action: "continue"`.
- **No silent project fallback.** Default nonempty project scans require an npm lockfile packages map. Manifest-only scans must explicitly select `--direct-only`.
- **Incomplete means retry.** Skipped dependencies, scan errors, and package limits return exit 1. MCP marks incomplete results with `isError: true`, even when the scanned subset has no findings.
- **Version-pinned script decisions.** New `allowScripts` entries target exact versions. Agent mode rejects writes, incomplete reviews cannot write, and existing denied permissions are not silently reopened.
- **Conservative script classification.** Implicit builds, partial source inspection, and missing pin-enforcement metadata require human review. A build-tool name embedded in arbitrary shell code cannot earn approval.

## Other improvements

Artifact verification now checks project lockfile integrity as well as registry metadata. Copies with equal names and versions but different sources or integrity are not collapsed into one review. Unsupported sources remain visible. OSV outages and disabled checks are distinguished from a successful clean lookup, and bulk lookup failures do not fan out into per-package retries.

The Action uses an isolated temporary installation and fails on incomplete reviews under every verdict policy. README, Agent Skill, MCP help, machine-readable documentation, website examples, and animations agree on version 3.0.0 and schema 3.

## Migration and support

Read [MIGRATING.md](https://github.com/Devrajsinh-Jhala/NPM-Vibe-check/blob/master/MIGRATING.md) before upgrading integrations.

3.0.0 is the **final planned release**. Active maintenance has ended; no future compatibility updates or security patches are scheduled. Releases and source remain available under MIT, and independent forks are welcome. See [MAINTENANCE.md](https://github.com/Devrajsinh-Jhala/NPM-Vibe-check/blob/master/MAINTENANCE.md).

A bounded scan is not an exhaustive audit or a safety certificate. External registries, advisory services, model APIs, and npm behavior may change independently of this frozen release.
