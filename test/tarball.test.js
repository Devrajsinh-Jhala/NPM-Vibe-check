import test from "node:test";
import assert from "node:assert/strict";
import { inspectTarball } from "../src/tarball.js";
import { makeTarball } from "./helpers/tar.js";

const base = [{ path: "package/package.json", text: JSON.stringify({
  name: "fixture", version: "1.0.0", scripts: { postinstall: "node install.js" },
}) }, { path: "package/install.js", text: "require('./payload');" },
{ path: "package/payload.js", text: "console.log('fixture');" }];

test("archive inspection follows relative imports without executing them", () => {
  const inspection = inspectTarball(makeTarball(base));
  assert.equal(inspection.packageJson.name, "fixture");
  assert.ok(inspection.selectedFiles.some((file) => file.path === "payload.js"));
});

test("selected-file and text budgets expose partial source inspection", () => {
  assert.ok(inspectTarball(makeTarball(base), { maxSelectedFiles: 1 }).omittedFileCount > 0);
  const partial = inspectTarball(makeTarball(base), { maxFileTextBytes: 8 });
  assert.ok(partial.selectedFiles.some((file) => file.truncated));
});

test("unsafe archive paths and symlinks are reported", () => {
  const result = inspectTarball(makeTarball([...base,
    { path: "../../outside", text: "x" },
    { path: "package/link", type: "2", link: "../../outside" },
  ]));
  assert.ok(result.findings.some((finding) => finding.code === "unsafe_tar_path"));
  assert.ok(result.findings.some((finding) => finding.code === "unsafe_symlink"));
});

test("truncated archives cannot hide an oversized declared entry", () => {
  const result = inspectTarball(makeTarball([...base,
    { path: "package/missing.js", declaredSize: 1000000, text: "short" },
  ]));
  assert.ok(result.findings.some((finding) => finding.code === "truncated_tarball"));
});

test("invalid gzip data and decompression bombs fail rather than hanging", () => {
  assert.throws(() => inspectTarball(Buffer.from("not gzip")), /Could not decompress/);
  assert.throws(() => inspectTarball(makeTarball(base), { maxDecompressedBytes: 512 }), /decompression limit/);
});
