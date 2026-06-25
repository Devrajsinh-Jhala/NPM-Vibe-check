import { createHash } from "node:crypto";
import { resolveVersion } from "./spec.js";
import { buildPackageProfile } from "./profile.js";

const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const DEFAULT_DOWNLOADS_API = "https://api.npmjs.org/downloads/point/last-week";
const USER_AGENT = "npx-vibe/1.2.0 (+https://www.npmjs.com/package/npx-vibe)";

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

  const response = await fetchWithTimeout(url, options);
  if (!response.ok) {
    throw new Error(`Could not download package tarball (${response.status} ${response.statusText}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
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
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Not found: ${url}`);
    }
    throw new Error(`Request failed for ${url} (${response.status} ${response.statusText}).`);
  }
  return response.json();
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? 15_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      headers: {
        "accept": "application/json",
        "user-agent": USER_AGENT,
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs}ms while fetching ${url}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
