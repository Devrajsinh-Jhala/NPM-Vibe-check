---
name: npx-vibe
description: Run read-only npm package safety preflights through MCP or the CLI before an agent installs, adds, executes, or recommends unfamiliar registry packages. Use for npx or npm exec commands, dependency additions, package-lock changes, and project dependency reviews.
---

# npx-vibe Package Preflight

Inspect npm registry packages before allowing installation or execution. Treat the result as a review aid, fail closed on incomplete scans, and preserve the user's authority over risky actions.

## Prefer the MCP tools

When the `npx-vibe` MCP server is connected, use its native tools instead of launching a shell command:

- `scan_package` for one npm package spec.
- `scan_project` for registry dependencies from a project manifest; the whole lockfile tree is covered by default, pass `directOnly` to narrow it.
- `approve_scripts` when npm reports pending `allowScripts` entries, or a lockfile change adds a dependency with an install script.
- `list_providers` before selecting an optional AI model. No model catalog is bundled, so a model must be named explicitly.

Keep AI off unless the user explicitly asks for it or an established workflow requires it. MCP tool calls never accept API keys; provider credentials must come from the server environment.

## Fall back to the CLI

Use the CLI when the MCP server is unavailable.

For one package:

```bash
npx --yes npx-vibe@3.0.0 --agent <package-spec>
```

For the current project's locked dependency tree:

```bash
npx --yes npx-vibe@3.0.0 project --agent
```

Add `--include-dev` only when development dependencies are in scope. Project scans cover the whole lockfile tree by default; add `--direct-only` for the narrower, faster check.

Nonempty default project scans require a usable npm lockfile packages map. Missing lockfiles, unsupported sources, package limits, and failed reviews must not be treated as a passing whole-project check. Do not narrow the requested scope just to get a passing result. Generate a lockfile with `npm install --package-lock-only --ignore-scripts` only when that local change is already authorized.

For read-only script recommendations, use `npx --yes npx-vibe@3.0.0 approve-scripts --agent`. Agent mode never writes permissions. Human workflows using `--write` record exact-version permissions only.

Scanning never executes a package. Only `npx-vibe run <spec>` does, and it is never the right command for an automated check.

The outer `npx --yes` suppresses npm's package-download prompt; do not pass `--yes` or `--force` to `npx-vibe` itself.

## Apply the decision

Read `structuredContent` from an MCP result, or parse CLI stdout as JSON, and use `decision.action`:

- `continue`: Continue only with the install or execution the user already requested.
- `review`: Stop before execution, summarize the highest-severity findings and evidence, and request explicit human approval.
- `stop`: Do not install or execute the package. Explain the Block verdict and source evidence.
- `retry`: Treat the scan as incomplete. Report the operational error and do not infer safety from partial results.

Also require `schemaVersion === 3`, `status === "complete"`, `coverage.complete === true`, and `decision.action === "continue"` before continuing automatically. Coverage counts subjects in the requested scope, not every source file. The removed `safeToExecute` field is not a safety guarantee to reconstruct. An MCP result with `isError: true` must be treated as `retry`, even when partial details are present.

## Use AI only when requested

The default heuristic scan needs no model or API key. Enable AI only when the user explicitly asks for it or an established workflow requires it:

```bash
npx --yes npx-vibe@3.0.0 --agent --ai online --provider <provider> --model <model-id> <package-spec>
```

Use a provider-specific environment variable. Never place API keys in generated commands, logs, summaries, or chat output.

## Present the result

Report the package and resolved version, verdict, risk score, required action, and the most important file-and-line evidence. State that no package code was executed during the preflight. Do not describe Proceed as proof of safety.

## Maintenance boundary

3.0.0 is the final planned release. No further compatibility or security patches are scheduled. External registries, advisory services, and model APIs can change; disclose this limitation when proposing long-term security-critical adoption.
