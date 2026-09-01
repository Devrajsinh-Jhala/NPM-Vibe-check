import test from "node:test";
import assert from "node:assert/strict";
import { findBinCommand, parseArgs, resolveNpmLauncher } from "../src/cli.js";
import { maybeRunAiReview } from "../src/ai.js";

test("parseArgs defaults to heuristic-only even when provider keys exist", () => {
  const args = parseArgs(["--check", "esbuild"], {
    GEMINI_API_KEY: "expired-key-that-must-not-be-used",
  });
  assert.equal(args.aiMode, "off");
});

test("--api-key is an explicit shortcut for online AI", () => {
  const args = parseArgs(["--api-key", "AIza-demo", "--check", "esbuild"], {});
  assert.equal(args.aiMode, "online");
  assert.equal(args.apiKey, "AIza-demo");
});

test("explicit --ai off wins over --api-key", () => {
  const args = parseArgs(["--ai", "off", "--api-key", "AIza-demo", "--check", "esbuild"], {});
  assert.equal(args.aiMode, "off");
});

test("the dedicated NPX_VIBE_API_KEY opts into online AI", () => {
  const args = parseArgs(["--check", "esbuild"], { NPX_VIBE_API_KEY: "AIza-demo" });
  assert.equal(args.aiMode, "online");
});

test("heuristic-only mode skips AI without reporting it unavailable", async () => {
  const review = await maybeRunAiReview({}, { needsAi: true }, {});
  assert.equal(review.status, "skipped");
  assert.match(review.reason, /not requested/i);
});

test("parseArgs supports no-hassle online and package args", () => {
  const args = parseArgs(["run", "--ai", "online", "--model=gpt-test", "cowsay", "--", "hello"], {});
  assert.equal(args.command, "run");
  assert.equal(args.aiMode, "online");
  assert.equal(args.model, "gpt-test");
  assert.equal(args.packageSpec, "cowsay");
  assert.deepEqual(args.packageArgs, ["hello"]);
});

test("model profiles are gone and --models lists providers", () => {
  assert.equal(parseArgs(["--models"], {}).models, true);
  assert.equal(parseArgs(["--model", "some-model", "esbuild"], {}).model, "some-model");
  assert.throws(() => parseArgs(["--model-profile", "strong", "esbuild"], {}), /Unknown option/);
});

test("findBinCommand picks obvious bin names", () => {
  assert.equal(findBinCommand({ bin: "cli.js" }, { name: "@scope/tool", unscopedName: "tool" }), "tool");
  assert.equal(findBinCommand({ bin: { tool: "cli.js", other: "other.js" } }, { name: "tool", unscopedName: "tool" }), "tool");
  assert.equal(findBinCommand({ bin: { only: "cli.js" } }, { name: "pkg", unscopedName: "pkg" }), "only");
});

test("--bin selects a named executable from multi-bin packages", () => {
  const args = parseArgs(["run", "--bin", "tsc", "typescript", "--", "--version"], {});
  assert.equal(args.bin, "tsc");
  assert.deepEqual(args.packageArgs, ["--version"]);
  assert.equal(
    findBinCommand(
      { bin: { tsc: "bin/tsc", tsserver: "bin/tsserver" } },
      { name: "typescript", unscopedName: "typescript" },
      args.bin,
    ),
    "tsc",
  );
});

test("--bin reports the executable names available from a package", () => {
  assert.throws(
    () => findBinCommand(
      { bin: { tsc: "bin/tsc", tsserver: "bin/tsserver" } },
      { name: "typescript", unscopedName: "typescript" },
      "missing",
    ),
    /Available binaries: tsc, tsserver/,
  );
});

test("parseArgs supports lock-aware project and CI scans", () => {
  const args = parseArgs([
    "--project",
    ".",
    "--include-dev",
    "--ci",
    "--concurrency",
    "4",
    "--ai-limit",
    "2",
  ], {});
  assert.equal(args.projectPath, ".");
  assert.equal(args.includeDev, true);
  assert.equal(args.ci, true);
  assert.equal(args.check, true);
  assert.equal(args.color, false);
  assert.equal(args.projectConcurrency, 4);
  assert.equal(args.projectAiLimit, 2);
});

test("--agent creates a non-interactive read-only package scan", () => {
  const args = parseArgs(["--agent", "esbuild"], {});
  assert.equal(args.agent, true);
  assert.equal(args.json, true);
  assert.equal(args.check, true);
  assert.equal(args.color, false);
  assert.equal(args.historyEnabled, false);
  assert.equal(args.aiMode, "off");
});

test("--agent supports project scans and explicit AI opt-in", () => {
  const project = parseArgs(["--agent", "--project", "."], {});
  const online = parseArgs(["--agent", "--ai", "online", "--provider", "gemini", "esbuild"], {});
  assert.equal(project.projectPath, ".");
  assert.equal(online.aiMode, "online");
  assert.equal(online.provider, "gemini");
});

test("--agent rejects execution-oriented options and package arguments", () => {
  // --agent is read-only whether or not the run command is used; that is the
  // more useful message, so it is checked before the run-only guard.
  assert.throws(() => parseArgs(["--agent", "--force", "esbuild"], {}), /read-only/);
  assert.throws(() => parseArgs(["--agent", "--yes", "esbuild"], {}), /read-only/);
  assert.throws(() => parseArgs(["--agent", "--allow-install-scripts", "esbuild"], {}), /read-only/);
  assert.throws(() => parseArgs(["run", "--agent", "--force", "esbuild"], {}), /read-only/);
  assert.throws(() => parseArgs(["--agent", "typescript", "--", "--version"], {}), /only apply to/);
});

test("scanning is the default and execution is an explicit command", () => {
  assert.equal(parseArgs(["esbuild"], {}).command, "scan");
  assert.equal(parseArgs(["run", "esbuild"], {}).command, "run");
  // Execution flags are meaningless without the run command.
  assert.throws(() => parseArgs(["--yes", "esbuild"], {}), /npx-vibe run/);
  assert.deepEqual(parseArgs(["run", "cowsay", "--", "moo"], {}).packageArgs, ["moo"]);
});

test("project scans are transitive by default and --direct-only opts out", () => {
  assert.equal(parseArgs(["--project", "."], {}).transitive, true);
  assert.equal(parseArgs(["--project", ".", "--direct-only"], {}).transitive, false);
  assert.equal(parseArgs(["--project", ".", "--direct-only"], {}).transitiveExplicit, true);
  assert.equal(parseArgs(["--project", "."], {}).transitiveExplicit, false);
  assert.throws(() => parseArgs(["--direct-only", "esbuild"], {}), /requires --project/);
});

test("project-only flags reject ambiguous package mode combinations", () => {
  assert.throws(() => parseArgs(["--include-dev", "esbuild"], {}), /requires --project/);
  assert.throws(() => parseArgs(["--ci", "esbuild"], {}), /requires --project/);
  assert.throws(() => parseArgs(["--project", ".", "esbuild"], {}), /either --project/);
  assert.throws(() => parseArgs(["--project", ".", "--bin", "tool"], {}), /not project scans/);
  assert.throws(() => parseArgs(["--project", ".", "--ci", "--json"], {}), /either --ci or --json/);
});

test("npm is launched without a shell on every platform", () => {
  const args = ["exec", "--yes", "--package", "cowsay@1.6.0"];

  // Node refuses to spawn npm.cmd without a shell, so Windows must reach npm's
  // JavaScript entry point directly rather than the .cmd shim.
  const viaNpx = resolveNpmLauncher(args, {}, { npm_execpath: "C:\npm\bin\npm-cli.js" }, "win32");
  assert.equal(viaNpx.command, process.execPath);
  assert.deepEqual(viaNpx.args, ["C:\npm\bin\npm-cli.js", ...args]);
  assert.equal(viaNpx.via, "npm_execpath");

  // An explicit override always wins.
  const override = resolveNpmLauncher(args, { npmBin: "/custom/npm" }, {}, "win32");
  assert.equal(override.command, "/custom/npm");
  assert.deepEqual(override.args, args);

  // A .cmd shim in npm_execpath is not a JavaScript entry point and is ignored.
  assert.notEqual(
    resolveNpmLauncher(args, {}, { npm_execpath: "C:\npm\npm.cmd", APPDATA: "" }, "linux").args[0],
    "C:\npm\npm.cmd"
  );

  const posix = resolveNpmLauncher(args, {}, {}, "linux");
  assert.equal(posix.command, "npm");
  assert.deepEqual(posix.args, args);
});
