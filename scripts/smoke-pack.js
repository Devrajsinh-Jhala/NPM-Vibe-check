import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const temporary = mkdtempSync(join(tmpdir(), "npx-vibe-pack-"));
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  const pack = run(npmBin, [
    "pack",
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    temporary,
  ], root);
  const packed = JSON.parse(pack.stdout);
  const filename = packed?.[0]?.filename;
  if (!filename) {
    throw new Error("npm pack did not report a tarball filename.");
  }

  const consumer = join(temporary, "consumer");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "package.json"), JSON.stringify({
    private: true,
    name: "npx-vibe-smoke",
    version: "0.0.0",
  }));
  run(npmBin, [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--prefix",
    consumer,
    join(temporary, filename),
  ], temporary);

  const cli = join(consumer, "node_modules", "npx-vibe", "bin", "npx-vibe.js");
  const version = run(process.execPath, [cli, "--version"], consumer).stdout.trim();
  if (version !== packageJson.version) {
    throw new Error(`Packed CLI reported ${version}; expected ${packageJson.version}.`);
  }
  const models = run(process.execPath, [cli, "--models"], consumer).stdout;
  if (!models.includes("balanced (default)")) {
    throw new Error("Packed CLI model catalog smoke test failed.");
  }
  const emptyProject = join(temporary, "empty-project");
  mkdirSync(emptyProject, { recursive: true });
  writeFileSync(join(emptyProject, "package.json"), JSON.stringify({
    private: true,
    name: "npx-vibe-empty-project",
    version: "0.0.0",
  }));
  const projectScan = run(process.execPath, [cli, "--project", emptyProject, "--no-history"], consumer).stdout;
  if (!projectScan.includes("Scanned: 0/0 direct dependencies")) {
    throw new Error("Packed CLI project-scan smoke test failed.");
  }

  console.log(`Packed-install smoke test passed for npx-vibe@${version}.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_dry_run: "false",
    },
    shell: process.platform === "win32" && /\.cmd$/i.test(command),
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed.\n${result.error?.message ?? ""}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim()
    );
  }
  return result;
}
