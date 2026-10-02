# Migrating to npx-vibe 3.0.0

This major release makes incomplete reviews visible, tightens install-script permissions, and introduces agent result schema 3. It is the [final planned release](MAINTENANCE.md).

## 1. Project scans require a usable lockfile

By default, `npx-vibe project` reviews the dependency tree recorded in an npm lockfile with a `packages` map (lockfile v2/v3). Nonempty projects without this map no longer silently fall back to direct dependencies.

Generate a lockfile without executing install scripts:

```bash
npm install --package-lock-only --ignore-scripts
npx --yes npx-vibe@3.0.0 project
```

For an intentionally narrower review, explicitly select direct dependencies:

```bash
npx --yes npx-vibe@3.0.0 project --direct-only
```

Malformed lockfiles fail rather than being ignored. Unsupported workspace links, Git dependencies, aliases, and foreign-registry artifacts are reported as skipped. Skipped packages, scan failures, and the package limit produce an **incomplete review (exit 1)** rather than a passing gate. Increase `--max-packages` (up to 5,000) when the default 500-package limit is too small; unsupported dependency types still need another review process.

Downloaded artifacts must match both registry integrity and any integrity recorded in the lockfile. A mismatch is a critical finding.

## 2. Agents must consume schema 3

Structured results now include a required `coverage` object:

```json
{
  "scope": "dependency-tree",
  "complete": false,
  "requested": 12,
  "scanned": 10,
  "skipped": 2,
  "failed": 0,
  "reasons": ["Two dependencies use unsupported sources."]
}
```

These counts describe packages or script-review targets in the requested scope, **not all source files**. Tarball analysis still reads selected, bounded files. A `--direct-only` review can be complete for that explicitly limited scope without covering transitive dependencies.

The misleading `decision.safeToExecute` property has been removed. A conservative continuation check is:

```js
const mayContinue = result.schemaVersion === 3
  && result.status === "complete"
  && result.coverage.complete === true
  && result.decision.action === "continue";
```

Incomplete reviews return `status: "incomplete"`, `decision.action: "retry"`, and exit code 1. MCP additionally sets `isError: true`. Results for the successfully scanned subset remain available for diagnosis; they are not permission to execute the whole project.

The MCP tool names remain `scan_package`, `scan_project`, `approve_scripts`, and `list_providers`. The supported MCP protocol has not changed; the tool-result schema has.

## 3. Install-script permissions are version-pinned

`approve-scripts --write` writes new permission entries such as `esbuild@0.28.2`, not a blanket `esbuild` permission. `--pin` remains accepted as a compatibility alias but is no longer necessary. Existing user-authored permissions are preserved, so review broad entries yourself:

```bash
npx --yes npx-vibe@3.0.0 approve-scripts --all
```

Implicit native builds and partially inspected source now require review instead of automatic approval. A recognizable build-tool name buried inside a different shell command no longer counts as an approved native build. Incomplete script reviews cannot write permissions. `--agent --write` is rejected; agent mode is read-only.

Missing lockfile `resolved` URLs also require review: npm cannot enforce an exact-version script approval for those entries. Refresh the lockfile without scripts rather than broadening permissions. Existing denied entries are never silently reopened.

## 4. Pin the Action and MCP server

```yaml
- uses: Devrajsinh-Jhala/NPM-Vibe-check@v3.0.0
  with:
    version: '3.0.0'
    fail-on: caution
```

The Action installs the requested release in an isolated temporary directory. Scan errors and incomplete coverage always fail, independently of the verdict threshold.

```json
{
  "mcpServers": {
    "npx-vibe": {
      "command": "npx",
      "args": ["--yes", "--package=npx-vibe@3.0.0", "npx-vibe-mcp"]
    }
  }
}
```

AI remains off by default. Online review requires an exact `--model` ID offered by the provider; retired model profiles are not restored. API keys belong in environment variables, not MCP tool arguments. External services can change after maintenance ends.
