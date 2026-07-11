import test from "node:test";
import assert from "node:assert/strict";
import { findBinCommand, parseArgs } from "../src/cli.js";
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
  const args = parseArgs(["--ai", "online", "--model=gpt-test", "cowsay", "--", "hello"], {});
  assert.equal(args.aiMode, "online");
  assert.equal(args.model, "gpt-test");
  assert.equal(args.packageSpec, "cowsay");
  assert.deepEqual(args.packageArgs, ["hello"]);
});

test("parseArgs supports model profiles and model catalog without a package", () => {
  const profileArgs = parseArgs(["--model-profile", "strong", "--check", "esbuild"], {});
  const catalogArgs = parseArgs(["--models"], {});
  assert.equal(profileArgs.modelProfile, "strong");
  assert.equal(catalogArgs.models, true);
  assert.throws(() => parseArgs(["--model-profile", "unknown", "esbuild"], {}), /fast, balanced, strong/);
});

test("findBinCommand picks obvious bin names", () => {
  assert.equal(findBinCommand({ bin: "cli.js" }, { name: "@scope/tool", unscopedName: "tool" }), "tool");
  assert.equal(findBinCommand({ bin: { tool: "cli.js", other: "other.js" } }, { name: "tool", unscopedName: "tool" }), "tool");
  assert.equal(findBinCommand({ bin: { only: "cli.js" } }, { name: "pkg", unscopedName: "pkg" }), "only");
});

test("--bin selects a named executable from multi-bin packages", () => {
  const args = parseArgs(["--bin", "tsc", "typescript", "--", "--version"], {});
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
