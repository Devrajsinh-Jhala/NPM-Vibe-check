const UNSUPPORTED_SPEC_PREFIXES = [
  /^git\+/i,
  /^https?:/i,
  /^file:/i,
  /^[./~]/,
  /^[a-zA-Z]:[\\/]/,
];

export function parsePackageSpec(input) {
  const raw = String(input ?? "").trim();

  if (!raw) {
    throw new Error("Missing package spec.");
  }

  if (UNSUPPORTED_SPEC_PREFIXES.some((pattern) => pattern.test(raw)) || raw.endsWith(".tgz")) {
    throw new Error("Only npm registry package names are supported.");
  }

  let name;
  let wanted = "latest";

  if (raw.startsWith("@")) {
    const slash = raw.indexOf("/");
    if (slash === -1) {
      throw new Error(`Invalid scoped package spec: ${raw}`);
    }

    const versionMarker = raw.indexOf("@", slash + 1);
    if (versionMarker === -1) {
      name = raw;
    } else {
      name = raw.slice(0, versionMarker);
      wanted = raw.slice(versionMarker + 1) || "latest";
    }
  } else {
    const versionMarker = raw.lastIndexOf("@");
    if (versionMarker > 0) {
      name = raw.slice(0, versionMarker);
      wanted = raw.slice(versionMarker + 1) || "latest";
    } else {
      name = raw;
    }
  }

  if (!isLikelyRegistryName(name)) {
    throw new Error(`Invalid npm registry package name: ${name}`);
  }

  return {
    raw,
    name,
    wanted,
    display: wanted === "latest" ? name : `${name}@${wanted}`,
    unscopedName: name.includes("/") ? name.split("/").pop() : name,
  };
}

export function isLikelyRegistryName(name) {
  return /^(@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(name);
}

export function resolveVersion(packument, wanted = "latest") {
  const versions = Object.keys(packument.versions ?? {});
  if (versions.length === 0) {
    throw new Error(`Package ${packument.name} has no published versions.`);
  }

  if (packument["dist-tags"]?.[wanted]) {
    return packument["dist-tags"][wanted];
  }

  if (packument.versions?.[wanted]) {
    return wanted;
  }

  const normalizedWanted = wanted.replace(/^v(?=\d+\.\d+\.\d+)/, "");
  if (packument.versions?.[normalizedWanted]) {
    return normalizedWanted;
  }

  const matching = versions
    .filter((version) => matchSemverRange(version, wanted))
    .sort(compareVersions)
    .pop();

  if (matching) {
    return matching;
  }

  throw new Error(`Could not resolve ${packument.name}@${wanted}.`);
}

export function matchSemverRange(version, range) {
  const parsed = parseVersion(version);
  if (!parsed) {
    return false;
  }

  const wanted = String(range ?? "").trim();
  if (!wanted || wanted === "*" || wanted.toLowerCase() === "latest") {
    return true;
  }

  if (/^\d+\.x$/i.test(wanted) || /^\d+\.\*$/.test(wanted)) {
    const major = Number(wanted.split(".")[0]);
    return parsed.major === major;
  }

  if (/^\d+\.\d+\.x$/i.test(wanted) || /^\d+\.\d+\.\*$/.test(wanted)) {
    const [major, minor] = wanted.split(".").map(Number);
    return parsed.major === major && parsed.minor === minor;
  }

  if (/^\d+$/.test(wanted)) {
    return parsed.major === Number(wanted);
  }

  if (/^\d+\.\d+$/.test(wanted)) {
    const [major, minor] = wanted.split(".").map(Number);
    return parsed.major === major && parsed.minor === minor;
  }

  const exact = parseVersion(wanted.replace(/^=/, "").replace(/^v/, ""));
  if (exact) {
    return compareVersions(version, versionFromParsed(exact)) === 0;
  }

  if (wanted.startsWith("^")) {
    const base = parseVersion(wanted.slice(1));
    if (!base || compareVersions(version, versionFromParsed(base)) < 0) {
      return false;
    }

    if (base.major > 0) {
      return parsed.major === base.major;
    }
    if (base.minor > 0) {
      return parsed.major === 0 && parsed.minor === base.minor;
    }
    return parsed.major === 0 && parsed.minor === 0 && parsed.patch === base.patch;
  }

  if (wanted.startsWith("~")) {
    const base = parseVersion(wanted.slice(1));
    if (!base || compareVersions(version, versionFromParsed(base)) < 0) {
      return false;
    }
    return parsed.major === base.major && parsed.minor === base.minor;
  }

  if (/^(<|<=|>|>=|=)/.test(wanted) || wanted.includes(" ")) {
    const comparators = wanted.split(/\s+/).filter(Boolean);
    return comparators.every((comparator) => matchComparator(version, comparator));
  }

  return false;
}

function matchComparator(version, comparator) {
  const match = comparator.match(/^(<=|>=|<|>|=)?(.+)$/);
  if (!match) {
    return false;
  }

  const operator = match[1] ?? "=";
  const target = parseVersion(match[2].replace(/^v/, ""));
  if (!target) {
    return false;
  }

  const comparison = compareVersions(version, versionFromParsed(target));
  switch (operator) {
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
    case "=":
      return comparison === 0;
    default:
      return false;
  }
}

export function parseVersion(version) {
  const match = String(version).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? "",
  };
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);

  if (!left && !right) {
    return String(a).localeCompare(String(b));
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }

  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) {
      return left[key] - right[key];
    }
  }

  if (left.prerelease === right.prerelease) {
    return 0;
  }
  if (!left.prerelease) {
    return 1;
  }
  if (!right.prerelease) {
    return -1;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

function comparePrerelease(a, b) {
  const left = a.split(".");
  const right = b.split(".");
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const l = left[index];
    const r = right[index];

    if (l === undefined) {
      return -1;
    }
    if (r === undefined) {
      return 1;
    }

    const lNumber = /^\d+$/.test(l) ? Number(l) : null;
    const rNumber = /^\d+$/.test(r) ? Number(r) : null;

    if (lNumber !== null && rNumber !== null && lNumber !== rNumber) {
      return lNumber - rNumber;
    }
    if (lNumber !== null && rNumber === null) {
      return -1;
    }
    if (lNumber === null && rNumber !== null) {
      return 1;
    }
    if (l !== r) {
      return l.localeCompare(r);
    }
  }

  return 0;
}

function versionFromParsed(version) {
  return `${version.major}.${version.minor}.${version.patch}${version.prerelease ? `-${version.prerelease}` : ""}`;
}
