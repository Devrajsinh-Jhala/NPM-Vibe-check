import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const files = [
  "bin/npx-vibe.js",
  "scripts/check-syntax.js",
  "scripts/serve-site.js",
  ...readdirSync("src")
    .filter((name) => name.endsWith(".js"))
    .map((name) => join("src", name)),
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}