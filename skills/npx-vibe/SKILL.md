---
name: npx-vibe
description: Run read-only npm package safety preflights before an agent installs, adds, executes, or recommends unfamiliar registry packages. Use for npx or npm exec commands, dependency additions, package-lock changes, and project dependency reviews.
---

# npx-vibe Package Preflight

Inspect npm registry packages before allowing installation or execution. Treat the result as a review aid, fail closed on incomplete scans, and preserve the user's authority over risky actions.

## Run the preflight

For one package:

```bash
npx --yes npx-vibe@latest --agent <package-spec>
```

For the current project's direct registry dependencies:

```bash
npx --yes npx-vibe@latest --agent --project .
```

Add `--include-dev` only when development dependencies are in scope. The outer `npx --yes` suppresses npm's package-download prompt; do not pass `--yes` or `--force` to `npx-vibe` itself.

## Apply the decision

Parse stdout as JSON and use `decision.action`:

- `continue`: Continue only with the install or execution the user already requested.
- `review`: Stop before execution, summarize the highest-severity findings and evidence, and request explicit human approval.
- `stop`: Do not install or execute the package. Explain the Block verdict and source evidence.
- `retry`: Treat the scan as incomplete. Report the operational error and do not infer safety from partial results.

Also require `schemaVersion === 1`, `status === "complete"`, and `decision.mayContinue === true` before continuing automatically.

## Use AI only when requested

The default heuristic scan needs no model or API key. Enable AI only when the user explicitly asks for it or an established workflow requires it:

```bash
npx --yes npx-vibe@latest --agent --ai online --provider <provider> <package-spec>
```

Use a provider-specific environment variable. Never place API keys in generated commands, logs, summaries, or chat output.

## Present the result

Report the package and resolved version, verdict, risk score, required action, and the most important file-and-line evidence. State that no package code was executed during the preflight. Do not describe Proceed as proof of safety.
