import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const files = [
  ...readdirSync("bin")
    .filter((name) => name.endsWith(".js"))
    .map((name) => join("bin", name)),
  "scripts/check-syntax.js",
  "scripts/smoke-pack.js",
  "scripts/serve-site.js",
  "site/app.js",
  ...readdirSync("src")
    .filter((name) => name.endsWith(".js"))
    .map((name) => join("src", name)),
].filter((file) => existsSync(file));

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
