import { gunzipSync } from "node:zlib";
import path from "node:path";

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".json",
  ".mjs",
  ".mts",
  ".ps1",
  ".sh",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
  ".lock",
]);

const LIFECYCLE_SCRIPT_NAMES = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "preprepare",
  "prepare",
  "postprepare",
]);

const COMMON_SUSPICIOUS_FILES = [
  "install.js",
  "postinstall.js",
  "preinstall.js",
  "setup.js",
  "prepare.js",
  "configure.js",
  "scripts/install.js",
  "scripts/postinstall.js",
  "scripts/preinstall.js",
  "scripts/setup.js",
];

export function inspectTarball(tgzBuffer, options = {}) {
  const findings = [];
  const limits = {
    maxTarballBytes: Number(options.maxTarballBytes ?? 20 * 1024 * 1024),
    maxUnpackedBytes: Number(options.maxUnpackedBytes ?? 60 * 1024 * 1024),
    maxEntries: Number(options.maxEntries ?? 2_000),
    maxSelectedFiles: Number(options.maxSelectedFiles ?? 40),
    maxSelectedBytes: Number(options.maxSelectedBytes ?? 384 * 1024),
    maxFileTextBytes: Number(options.maxFileTextBytes ?? 64 * 1024),
  };

  if (tgzBuffer.length > limits.maxTarballBytes) {
    findings.push({
      severity: "medium",
      code: "large_tarball",
      file: null,
      detail: `Tarball is ${(tgzBuffer.length / 1024 / 1024).toFixed(1)} MiB, above the ${Math.round(limits.maxTarballBytes / 1024 / 1024)} MiB review limit.`,
    });
  }

  let tarBuffer;
  try {
    tarBuffer = gunzipSync(tgzBuffer);
  } catch (error) {
    throw new Error(`Could not decompress package tarball: ${error.message}`);
  }

  if (tarBuffer.length > limits.maxUnpackedBytes) {
    findings.push({
      severity: "high",
      code: "large_unpacked_tarball",
      file: null,
      detail: `Unpacked tarball is ${(tarBuffer.length / 1024 / 1024).toFixed(1)} MiB, above the ${Math.round(limits.maxUnpackedBytes / 1024 / 1024)} MiB review limit.`,
    });
  }

  const { entries, findings: tarFindings } = parseTar(tarBuffer, limits);
  findings.push(...tarFindings);

  const fileMap = createFileMap(entries);
  const packageJsonEntry = findPackageJson(entries);
  const packageJson = parsePackageJson(packageJsonEntry);
  const selectedFiles = selectFilesForReview(entries, fileMap, packageJson, limits);

  return {
    entries,
    fileCount: entries.filter((entry) => entry.type === "file").length,
    totalUnpackedBytes: tarBuffer.length,
    packageJson,
    selectedFiles,
    findings,
  };
}

export function normalizePackagePath(tarPath) {
  return String(tarPath).replace(/^package\//, "");
}

function parseTar(buffer, limits) {
  const entries = [];
  const findings = [];
  let offset = 0;
  let pendingLongName = null;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (isZeroBlock(header)) {
      break;
    }

    const name = readString(header, 0, 100);
    const mode = readString(header, 100, 8);
    const size = readOctal(header, 124, 12);
    const typeflag = readString(header, 156, 1) || "0";
    const linkname = readString(header, 157, 100);
    const prefix = readString(header, 345, 155);

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    const nextOffset = dataStart + Math.ceil(size / 512) * 512;

    if (dataEnd > buffer.length) {
      findings.push({
        severity: "critical",
        code: "truncated_tarball",
        file: null,
        detail: "Tarball ended before a file's declared size.",
      });
      break;
    }

    if (typeflag === "L") {
      pendingLongName = buffer.subarray(dataStart, dataEnd).toString("utf8").replace(/\0+$/, "");
      offset = nextOffset;
      continue;
    }

    if (typeflag === "x" || typeflag === "g") {
      offset = nextOffset;
      continue;
    }

    const rawPath = pendingLongName ?? [prefix, name].filter(Boolean).join("/");
    pendingLongName = null;

    const normalized = normalizeTarPath(rawPath);
    if (!normalized.safe) {
      findings.push({
        severity: "critical",
        code: "unsafe_tar_path",
        file: rawPath,
        detail: `Archive entry uses an unsafe path: ${rawPath}`,
      });
    }

    const entry = {
      path: normalized.path,
      rawPath,
      type: tarType(typeflag),
      size,
      mode,
      linkname,
      data: typeflag === "0" || typeflag === "" ? buffer.subarray(dataStart, dataEnd) : null,
    };

    if (entry.type === "symlink" && linkname && !normalizeTarPath(linkname).safe) {
      findings.push({
        severity: "high",
        code: "unsafe_symlink",
        file: rawPath,
        detail: `Symlink points outside the package: ${linkname}`,
      });
    }

    entries.push(entry);
    if (entries.length > limits.maxEntries) {
      findings.push({
        severity: "high",
        code: "too_many_archive_entries",
        file: null,
        detail: `Archive has more than ${limits.maxEntries} entries.`,
      });
      break;
    }

    offset = nextOffset;
  }

  return { entries, findings };
}

function createFileMap(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (entry.type === "file") {
      map.set(normalizePackagePath(entry.path), entry);
    }
  }
  return map;
}

function findPackageJson(entries) {
  return entries.find((entry) => entry.type === "file" && normalizePackagePath(entry.path) === "package.json");
}

function parsePackageJson(entry) {
  if (!entry?.data) {
    return null;
  }

  try {
    return JSON.parse(entry.data.toString("utf8"));
  } catch {
    return null;
  }
}

function selectFilesForReview(entries, fileMap, packageJson, limits) {
  const selected = new Map();
  const queue = [];

  const addCandidate = (packagePath, reason) => {
    const normalized = normalizePackagePath(packagePath).replace(/\\/g, "/").replace(/^\.\//, "");
    const entry = fileMap.get(normalized);
    if (!entry || entry.type !== "file") {
      return;
    }
    if (!looksTextual(entry.path, entry.data)) {
      return;
    }
    if (!selected.has(normalized)) {
      selected.set(normalized, { entry, reasons: new Set([reason]) });
      queue.push(normalized);
    } else {
      selected.get(normalized).reasons.add(reason);
    }
  };

  addCandidate("package.json", "manifest");
  addCandidate("npm-shrinkwrap.json", "lockfile");
  addCandidate("package-lock.json", "lockfile");
  addCandidate("pnpm-lock.yaml", "lockfile");
  addCandidate("yarn.lock", "lockfile");

  for (const scriptName of Object.keys(packageJson?.scripts ?? {})) {
    if (LIFECYCLE_SCRIPT_NAMES.has(scriptName)) {
      for (const target of scriptTargets(packageJson.scripts[scriptName])) {
        addCandidate(target, `${scriptName} script target`);
      }
    }
  }

  const bin = packageJson?.bin;
  if (typeof bin === "string") {
    addCandidate(bin, "bin entrypoint");
  } else if (bin && typeof bin === "object") {
    for (const target of Object.values(bin)) {
      if (typeof target === "string") {
        addCandidate(target, "bin entrypoint");
      }
    }
  }

  for (const common of COMMON_SUSPICIOUS_FILES) {
    addCandidate(common, "suspicious conventional filename");
  }

  for (const entry of entries) {
    const packagePath = normalizePackagePath(entry.path);
    if (entry.type !== "file") {
      continue;
    }
    if (/(^|\/)(preinstall|postinstall|install|setup|prepare|configure|payload|update)[._-]?[a-z0-9-]*\.(cjs|js|mjs|ps1|sh|ts)$/i.test(packagePath)) {
      addCandidate(packagePath, "suspicious filename");
    }
  }

  let selectedBytes = 0;
  for (let index = 0; index < queue.length && index < limits.maxSelectedFiles; index += 1) {
    const packagePath = queue[index];
    const item = selected.get(packagePath);
    if (!item) {
      continue;
    }

    selectedBytes += Math.min(item.entry.size, limits.maxFileTextBytes);
    if (selectedBytes > limits.maxSelectedBytes) {
      break;
    }

    const text = item.entry.data.toString("utf8", 0, Math.min(item.entry.data.length, limits.maxFileTextBytes));
    for (const imported of relativeImports(text, packagePath)) {
      addCandidate(imported, `relative import from ${packagePath}`);
    }
  }

  return Array.from(selected.entries()).slice(0, limits.maxSelectedFiles).map(([packagePath, item]) => {
    const text = item.entry.data.toString("utf8", 0, Math.min(item.entry.data.length, limits.maxFileTextBytes));
    return {
      path: packagePath,
      tarPath: item.entry.path,
      size: item.entry.size,
      truncated: item.entry.data.length > limits.maxFileTextBytes,
      reasons: Array.from(item.reasons),
      text,
    };
  });
}

function scriptTargets(script) {
  const targets = new Set();
  const command = String(script ?? "");
  const patterns = [
    /(?:^|[;&|]\s*)(?:node|bun|deno|tsx|ts-node)\s+(?:--[^\s]+\s+)*["']?([^"'\s;&|]+)["']?/gi,
    /(?:^|[;&|]\s*)["']?((?:\.\/|scripts\/|bin\/)?[^"'\s;&|]+\.(?:cjs|js|mjs|ps1|sh|ts))["']?/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(command)) !== null) {
      targets.add(match[1].replace(/^['"]|['"]$/g, ""));
    }
  }

  return targets;
}

function relativeImports(text, fromPackagePath) {
  const imports = new Set();
  const dirname = path.posix.dirname(fromPackagePath);
  const patterns = [
    /\brequire\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
    /\bimport\s+(?:[^"']+\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g,
    /\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const base = path.posix.normalize(path.posix.join(dirname, match[1]));
      for (const candidate of importCandidates(base)) {
        imports.add(candidate);
      }
    }
  }

  return imports;
}

function importCandidates(base) {
  if (path.posix.extname(base)) {
    return [base];
  }
  return [
    base,
    `${base}.js`,
    `${base}.cjs`,
    `${base}.mjs`,
    `${base}.ts`,
    `${base}/index.js`,
    `${base}/index.cjs`,
    `${base}/index.mjs`,
  ];
}

function looksTextual(tarPath, data) {
  const extension = path.posix.extname(tarPath).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) {
    return true;
  }
  if (!data || data.length === 0) {
    return true;
  }
  const prefix = data.subarray(0, Math.min(data.length, 512));
  return !prefix.includes(0);
}

function normalizeTarPath(rawPath) {
  const replaced = String(rawPath).replace(/\\/g, "/");
  const normalized = path.posix.normalize(replaced);
  const safe = Boolean(replaced) && !path.posix.isAbsolute(replaced) && normalized !== "." && !normalized.startsWith("../") && normalized !== "..";
  return {
    path: normalized,
    safe,
  };
}

function tarType(typeflag) {
  switch (typeflag) {
    case "0":
    case "":
      return "file";
    case "2":
      return "symlink";
    case "5":
      return "directory";
    default:
      return `type-${typeflag}`;
  }
}

function readString(buffer, start, length) {
  return buffer
    .subarray(start, start + length)
    .toString("utf8")
    .replace(/\0.*$/, "")
    .trim();
}

function readOctal(buffer, start, length) {
  const value = readString(buffer, start, length).replace(/\s/g, "");
  return value ? Number.parseInt(value, 8) : 0;
}

function isZeroBlock(buffer) {
  for (const byte of buffer) {
    if (byte !== 0) {
      return false;
    }
  }
  return true;
}
