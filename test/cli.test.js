import test from "node:test";
import assert from "node:assert/strict";
import { findBinCommand, parseArgs } from "../src/cli.js";

test("parseArgs supports no-hassle online and package args", () => {
  const args = parseArgs(["--ai", "online", "--model=gpt-test", "cowsay", "--", "hello"], {});
  assert.equal(args.aiMode, "online");
  assert.equal(args.model, "gpt-test");
  assert.equal(args.packageSpec, "cowsay");
  assert.deepEqual(args.packageArgs, ["hello"]);
});

test("findBinCommand picks obvious bin names", () => {
  assert.equal(findBinCommand({ bin: "cli.js" }, { name: "@scope/tool", unscopedName: "tool" }), "tool");
  assert.equal(findBinCommand({ bin: { tool: "cli.js", other: "other.js" } }, { name: "tool", unscopedName: "tool" }), "tool");
  assert.equal(findBinCommand({ bin: { only: "cli.js" } }, { name: "pkg", unscopedName: "pkg" }), "only");
});