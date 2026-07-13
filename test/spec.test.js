import test from "node:test";
import assert from "node:assert/strict";
import { parsePackageSpec, resolveVersion, matchSemverRange } from "../src/spec.js";

test("parsePackageSpec handles scoped packages and versions", () => {
  assert.deepEqual(parsePackageSpec("@scope/tool@1.2.3"), {
    raw: "@scope/tool@1.2.3",
    name: "@scope/tool",
    wanted: "1.2.3",
    display: "@scope/tool@1.2.3",
    unscopedName: "tool",
  });
});

test("parsePackageSpec rejects non-registry specs", () => {
  assert.throws(() => parsePackageSpec("https://example.com/pkg.tgz"), /Only npm registry/);
  assert.throws(() => parsePackageSpec("./local-package"), /Only npm registry/);
});

test("resolveVersion supports tags and common semver ranges", () => {
  const packument = {
    name: "demo",
    "dist-tags": { latest: "2.1.0", beta: "3.0.0-beta.1" },
    versions: {
      "1.0.0": {},
      "1.5.0": {},
      "2.0.0": {},
      "2.1.0": {},
      "3.0.0-beta.1": {},
    },
  };

  assert.equal(resolveVersion(packument, "latest"), "2.1.0");
  assert.equal(resolveVersion(packument, "beta"), "3.0.0-beta.1");
  assert.equal(resolveVersion(packument, "^1.0.0"), "1.5.0");
  assert.equal(resolveVersion(packument, "2.x"), "2.1.0");
});

test("matchSemverRange handles comparator sets", () => {
  assert.equal(matchSemverRange("1.5.0", ">=1.0.0 <2.0.0"), true);
  assert.equal(matchSemverRange("2.0.0", ">=1.0.0 <2.0.0"), false);
  assert.equal(matchSemverRange("3.1.0", "^1.0.0 || ^3.0.0"), true);
});
