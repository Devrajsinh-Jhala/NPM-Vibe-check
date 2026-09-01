const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
const OSV_VULN_URL = "https://api.osv.dev/v1/vulns";
const BATCH_SIZE = 500;
const MAX_DETAIL_LOOKUPS = 60;

// OSV needs no API key and answers in bulk, which is what makes this affordable
// for a whole dependency tree. The batch endpoint returns ids only, so anything
// that actually matched is followed up once for severity and summary.
export async function fetchAdvisories(packages, options = {}) {
  const results = new Map();
  const wanted = packages.filter((entry) => entry?.name && entry?.version);
  if (wanted.length === 0) {
    return results;
  }

  const idsByKey = new Map();
  const allIds = new Set();
  // Keys whose batch actually answered. A clean package has to be recorded as
  // "checked, nothing found", or a project scan falls back to one call each and
  // the batching buys nothing. A failed chunk is left absent so it is retried.
  const checked = new Set();

  for (let index = 0; index < wanted.length; index += BATCH_SIZE) {
    const chunk = wanted.slice(index, index + BATCH_SIZE);
    const payload = await postJson(OSV_BATCH_URL, {
      queries: chunk.map((entry) => ({
        package: { ecosystem: "npm", name: entry.name },
        version: entry.version,
      })),
    }, options).catch(() => null);

    if (!payload || !Array.isArray(payload.results)) {
      continue;
    }

    payload.results.forEach((result, offset) => {
      const entry = chunk[offset];
      if (!entry) {
        return;
      }
      checked.add(`${entry.name}@${entry.version}`);
      const ids = (result?.vulns ?? []).map((vuln) => vuln.id).filter(Boolean);
      if (ids.length === 0) {
        return;
      }
      idsByKey.set(`${entry.name}@${entry.version}`, ids);
      for (const id of ids) {
        allIds.add(id);
      }
    });
  }

  const details = await fetchVulnerabilityDetails([...allIds].slice(0, MAX_DETAIL_LOOKUPS), options);

  for (const key of checked) {
    results.set(key, []);
  }
  for (const [key, ids] of idsByKey) {
    results.set(key, ids.map((id) => details.get(id) ?? { id, severity: "UNKNOWN", summary: null, aliases: [] }));
  }
  return results;
}

async function fetchVulnerabilityDetails(ids, options) {
  const details = new Map();
  await Promise.all(ids.map(async (id) => {
    const vuln = await getJson(`${OSV_VULN_URL}/${encodeURIComponent(id)}`, options).catch(() => null);
    if (!vuln) {
      return;
    }
    details.set(id, {
      id: vuln.id ?? id,
      severity: String(vuln.database_specific?.severity ?? "UNKNOWN").toUpperCase(),
      summary: vuln.summary ? String(vuln.summary).slice(0, 200) : null,
      aliases: Array.isArray(vuln.aliases) ? vuln.aliases.slice(0, 4) : [],
    });
  }));
  return details;
}

export function advisoryFinding(advisories, spec) {
  if (!Array.isArray(advisories) || advisories.length === 0) {
    return null;
  }

  const ranked = [...advisories].sort(
    (left, right) => severityRank(right.severity) - severityRank(left.severity)
  );
  const worst = ranked[0];
  const named = ranked.slice(0, 3).map((advisory) => {
    const alias = advisory.aliases?.find((value) => value.startsWith("CVE-"));
    return `${advisory.id}${alias ? ` (${alias})` : ""} ${advisory.severity}`;
  });

  return {
    severity: findingSeverity(worst.severity),
    code: "known_vulnerability",
    file: null,
    detail:
      `${advisories.length} known ${advisories.length === 1 ? "advisory" : "advisories"} for ${spec}: ` +
      `${named.join("; ")}${advisories.length > named.length ? `; and ${advisories.length - named.length} more` : ""}.`,
    evidence: worst.summary ? [{ line: null, excerpt: worst.summary }] : [],
  };
}

function severityRank(severity) {
  switch (String(severity ?? "").toUpperCase()) {
    case "CRITICAL": return 4;
    case "HIGH": return 3;
    case "MODERATE":
    case "MEDIUM": return 2;
    case "LOW": return 1;
    default: return 0;
  }
}

// A published advisory is a maintenance problem, not evidence of malice, so it
// tops out at high and never forces a Block on its own.
function findingSeverity(severity) {
  switch (String(severity ?? "").toUpperCase()) {
    case "CRITICAL":
    case "HIGH": return "high";
    case "LOW": return "low";
    default: return "medium";
  }
}

async function postJson(url, body, options) {
  return request(url, { method: "POST", body: JSON.stringify(body) }, options);
}

async function getJson(url, options) {
  return request(url, { method: "GET" }, options);
}

async function request(url, init, options = {}) {
  const timeoutMs = Number(options.advisoryTimeoutMs ?? options.timeoutMs ?? 15_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OSV request failed (${response.status} ${response.statusText}).`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs}ms while querying OSV.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
