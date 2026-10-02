import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadPackageSnapshot, verifyTarball } from "../src/registry.js";
import { reviewPackage } from "../src/cli.js";
import { makeTarball } from "./helpers/tar.js";

const manifest = { name: "fixture-package", version: "1.0.0", bin: "cli.js" };
const bytes = makeTarball([
  { path: "package/package.json", text: JSON.stringify(manifest) },
  { path: "package/cli.js", text: "console.log('fixture');" },
]);
const integrity = "sha512-" + createHash("sha512").update(bytes).digest("base64");
const spec = { name: manifest.name, wanted: manifest.version };

function mockRegistry(t, options = {}) {
  const packageManifest = { ...manifest, dist: { tarball: "https://registry.npmjs.org/fixture.tgz",
    ...(options.missingIntegrity ? {} : { integrity }) } };
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.endsWith(".tgz")) return new Response(bytes);
    if (url.includes("api.osv.dev")) throw new Error("OSV unavailable");
    return Response.json({ name: manifest.name, "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": packageManifest }, time: { created: "2017-01-01", "1.0.0": "2018-01-01" } });
  });
}
const config = { aiMode: "off", historyEnabled: false, githubMetadata: false,
  downloadsCache: new Map([[manifest.name, { downloads: 10000 }]]), advisories: false };

test("tarball verification rejects different bytes and unsupported integrity", () => {
  assert.equal(verifyTarball(bytes, { integrity }).ok, true);
  assert.equal(verifyTarball(Buffer.from("changed"), { integrity }).ok, false);
  assert.equal(verifyTarball(bytes, { integrity: "md5-unsupported" }).checked, false);
});

test("review verifies locked integrity, not just registry integrity", async (t) => {
  mockRegistry(t);
  const matching = await reviewPackage("fixture-package@1.0.0", { ...config, lockedIntegrity: integrity });
  assert.equal(matching.result.package.integrity.ok, true);
  const wrong = "sha512-" + createHash("sha512").update("different artifact").digest("base64");
  const mismatching = await reviewPackage("fixture-package@1.0.0", { ...config, lockedIntegrity: wrong });
  assert.equal(mismatching.result.verdict.verdict, "block");
  assert.equal(mismatching.result.package.integrity.ok, false);
  assert.ok(mismatching.result.findings.some((item) => item.code === "integrity_mismatch"));
});

test("unverifiable registry or lockfile integrity cannot produce a completed review", async (t) => {
  mockRegistry(t, { missingIntegrity: true });
  await assert.rejects(() => reviewPackage("fixture-package", config), /no supported integrity/);
  t.mock.restoreAll();
  mockRegistry(t);
  await assert.rejects(() => reviewPackage("fixture-package", { ...config, lockedIntegrity: "md5-old" }), /Lockfile integrity.*unsupported/);
});

test("OSV failures and disabled queries remain distinguishable from a clean query", async (t) => {
  mockRegistry(t);
  assert.equal((await loadPackageSnapshot(spec, config)).advisoryStatus, "skipped");
  assert.equal((await loadPackageSnapshot(spec, { ...config, advisories: true })).advisoryStatus, "unavailable");
  assert.equal((await loadPackageSnapshot(spec, { ...config, advisories: true,
    advisoriesCache: new Map([["fixture-package@1.0.0", []]]) })).advisoryStatus, "checked");
});

test("an unavailable bulk advisory lookup does not trigger one retry per dependency", async (t) => {
  mockRegistry(t);
  const before = globalThis.fetch.mock.callCount();
  const result = await loadPackageSnapshot(spec, { ...config, advisories: true, advisoriesCache: new Map() });
  assert.equal(result.advisoryStatus, "unavailable");
  assert.equal(globalThis.fetch.mock.callCount() - before, 1, "only the registry packument is fetched");
});
