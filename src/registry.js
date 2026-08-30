import { createHash } from "node:crypto";
import { resolveVersion } from "./spec.js";
import { buildPackageProfile } from "./profile.js";
import { userAgent } from "./version.js";

const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const DEFAULT_DOWNLOADS_API = "https://api.npmjs.org/downloads/point/last-week";
const DEFAULT_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

export async function loadPackageSnapshot(spec, options = {}) {
  const registry = stripTrailingSlash(options.registry ?? DEFAULT_REGISTRY);
  const packument = await fetchJson(`${registry}/${encodePackageName(spec.name)}`, options);
  const version = resolveVersion(packument, spec.wanted);
  const manifest = packument.versions?.[version];

  if (!manifest) {
    throw new Error(`Registry metadata for ${spec.name}@${version} was incomplete.`);
  }

  const downloads = await fetchDownloads(spec.name, options).catch((error) => ({
    downloads: null,
    error: error.message,
  }));
  const profile = await buildPackageProfile(packument, manifest, version, options);

  return {
    spec,
    registry,
    packument,
    version,
    manifest,
    downloads,
    tarball: manifest.dist?.tarball,
    integrity: manifest.dist?.integrity,
    shasum: manifest.dist?.shasum,
    packageCreatedAt: packument.time?.created ?? null,
    packageModifiedAt: packument.time?.modified ?? null,
    versionPublishedAt: packument.time?.[version] ?? null,
    profile,
  };
}

export async function fetchDownloads(packageName, options = {}) {
  const url = `${DEFAULT_DOWNLOADS_API}/${encodeURIComponent(packageName)}`;
  return fetchJson(url, options);
}

export async function downloadTarball(url, options = {}) {
  if (!url) {
    throw new Error("Package metadata did not include a tarball URL.");
  }

  const maxBytes = Number(options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES);
  return requestWithTimeout(url, options, async (response) => {
    if (!response.ok) {
      throw new Error(`Could not download package tarball (${response.status} ${response.statusText}).`);
    }

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(oversizeMessage(declared, maxBytes));
    }

    return readBodyWithLimit(response, maxBytes);
  });
}

export function verifyTarball(buffer, snapshot) {
  const results = [];

  if (snapshot.integrity) {
    const parsed = parseIntegrity(snapshot.integrity);
    if (parsed) {
      const digest = createHash(parsed.algorithm).update(buffer).digest("base64");
      results.push({
        type: "integrity",
        algorithm: parsed.algorithm,
        expected: parsed.digest,
        actual: digest,
        ok: digest === parsed.digest,
      });
    }
  }

  if (snapshot.shasum) {
    const digest = createHash("sha1").update(buffer).digest("hex");
    results.push({
      type: "shasum",
      algorithm: "sha1",
      expected: snapshot.shasum,
      actual: digest,
      ok: digest === snapshot.shasum,
    });
  }

  return {
    checked: results.length > 0,
    ok: results.length === 0 ? true : results.every((result) => result.ok),
    results,
  };
}

export async function fetchJson(url, options = {}) {
  return requestWithTimeout(url, options, async (response) => {
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Not found: ${url}`);
      }
      throw new Error(`Request failed for ${url} (${response.status} ${response.statusText}).`);
    }
    return response.json();
  });
}

// The abort signal has to stay armed while the body is read. Clearing the timer
// as soon as the headers arrive left every body read untimed and unbounded, so a
// slow-drip or endless response body hung the scan indefinitely.
async function requestWithTimeout(url, options = {}, consume) {
  const timeoutMs = Number(options.timeoutMs ?? 15_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "accept": "application/json",
        "user-agent": userAgent(),
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
    });
    return await consume(response);
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs}ms while fetching ${url}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readBodyWithLimit(response, maxBytes) {
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(oversizeMessage(buffer.length, maxBytes));
    }
    return buffer;
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error(oversizeMessage(total, maxBytes));
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

function oversizeMessage(bytes, maxBytes) {
  return `Package tarball exceeds the ${Math.round(maxBytes / 1024 / 1024)} MiB download limit `
    + `(at least ${(bytes / 1024 / 1024).toFixed(1)} MiB).`;
}

function parseIntegrity(integrity) {
  const first = String(integrity).split(/\s+/).find(Boolean);
  const match = first?.match(/^(sha1|sha256|sha384|sha512)-(.+)$/);
  if (!match) {
    return null;
  }
  return {
    algorithm: match[1],
    digest: match[2],
  };
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function encodePackageName(name) {
  return name.startsWith("@") ? name.replace("/", "%2F") : encodeURIComponent(name);
}
