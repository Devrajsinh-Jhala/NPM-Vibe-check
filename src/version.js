import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached = null;

export function packageVersion() {
  if (cached === null) {
    const here = dirname(fileURLToPath(import.meta.url));
    cached = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;
  }
  return cached;
}

export function userAgent() {
  return `npx-vibe/${packageVersion()} (+https://www.npmjs.com/package/npx-vibe)`;
}
