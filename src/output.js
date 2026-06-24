const SYMBOLS = {
  proceed: "✓",
  caution: "!",
  block: "✕",
};

export function renderDashboard(result, options = {}) {
  const color = createColor(Boolean(options.color));
  const verdict = result.verdict.verdict;
  const headline =
    verdict === "proceed"
      ? color.green("Proceed")
      : verdict === "caution"
        ? color.yellow("Caution")
        : color.red("Block");

  const lines = [];
  lines.push(`${SYMBOLS[verdict]} npx-vibe: ${headline}  ${color.dim(`risk ${result.verdict.score}/100`)}`);
  lines.push(`${result.package.name}@${result.package.version}`);
  if (result.profile?.description) {
    lines.push(color.dim(trim(result.profile.description, 120)));
  }
  lines.push("");
  lines.push(...profileLines(result));
  lines.push(`Downloads: ${formatDownloads(result.stats.weeklyDownloads)}/week  Package age: ${formatDays(result.stats.packageAgeDays)}  Version age: ${formatDays(result.stats.versionAgeDays)}`);
  lines.push(`Install hooks: ${result.stats.lifecycleScripts.length ? result.stats.lifecycleScripts.map((script) => script.name).join(", ") : "none"}`);
  lines.push(
    `Inspected: ${result.stats.selectedFileCount} selected ${pluralize("file", result.stats.selectedFileCount)} ` +
      `from ${result.stats.fileCount} package ${pluralize("file", result.stats.fileCount)}`
  );
  lines.push(...trustContextLines(result.stats.trustContext, color));

  if (result.ai.status === "ok") {
    lines.push(`AI review: ${result.ai.providerLabel ?? result.ai.provider} ${result.ai.model} (${result.ai.confidence} confidence)`);
  } else if (result.ai.status === "skipped") {
    lines.push(`AI review: skipped (${result.ai.reason})`);
  } else {
    lines.push(`AI review: unavailable (${result.ai.reason})`);
  }

  const findings = result.findings.slice(0, 10);
  if (findings.length) {
    lines.push("");
    lines.push("Findings:");
    for (const finding of findings) {
      const marker = colorSeverity(finding.severity, color)(finding.severity.toUpperCase().padEnd(8));
      lines.push(`- ${marker} ${finding.code}${finding.file ? ` in ${finding.file}` : ""}`);
      lines.push(`  ${finding.detail}`);
      for (const evidence of (finding.evidence ?? []).slice(0, 2)) {
        const location = evidence.line ? ` line ${evidence.line}` : "";
        lines.push(color.dim(`  Evidence${location}: ${trim(evidence.excerpt, 180)}`));
      }
    }
    if (result.findings.length > findings.length) {
      lines.push(`- … ${result.findings.length - findings.length} more finding(s) omitted`);
    }
  }

  if (result.ai.status === "ok" && result.ai.summary) {
    lines.push("");
    lines.push(`AI summary: ${result.ai.summary}`);
  }

  lines.push("");
  lines.push(actionLine(result, color));
  return `${lines.join("\n")}\n`;
}

export function toJsonResult(result) {
  return JSON.stringify(result, null, 2);
}

function profileLines(result) {
  const profile = result.profile ?? {};
  const lines = [];
  const npm = profile.npm ?? {};
  lines.push(`NPM updated: ${formatDate(npm.modifiedAt)}  Version published: ${formatDate(npm.versionPublishedAt)}  Latest tag: ${profile.latestVersion ?? "unknown"}`);
  lines.push(`License: ${profile.license ?? "unknown"}  Maintainers: ${formatMaintainers(profile)}  Publisher: ${profile.publisher?.name ?? "unknown"}`);

  if (profile.repository?.display) {
    lines.push(`Repository: ${profile.repository.display}`);
  } else {
    lines.push("Repository: unknown");
  }

  if (profile.github?.error) {
    lines.push(`GitHub: unavailable (${profile.github.error})`);
  } else if (profile.github) {
    const latest = profile.github.latestCommit;
    lines.push(`GitHub: ${formatCount(profile.github.stars)} stars  Updated: ${formatDate(profile.github.updatedAt)}  Pushed: ${formatDate(profile.github.pushedAt)}`);
    lines.push(`Last commit: ${latest?.sha ?? "unknown"}${latest?.date ? ` on ${formatDate(latest.date)}` : ""}${latest?.message ? ` — ${trim(latest.message, 80)}` : ""}`);
  } else {
    lines.push("Last commit: unknown");
  }

  if (profile.deprecated) {
    lines.push(`Deprecated: ${trim(profile.deprecated, 140)}`);
  }

  return lines;
}

function trustContextLines(trustContext, color) {
  if (!trustContext?.signals?.length) {
    return [];
  }
  const label = trustContext.level === "established-signals" ? "Established signals" : "Registry context";
  return [
    `${label}: ${trustContext.signals.join(", ")}`,
    color.dim(trustContext.note),
  ];
}

function actionLine(result, color) {
  if (result.verdict.verdict === "proceed") {
    return color.green("Action: package may be executed.");
  }
  if (result.verdict.verdict === "caution") {
    return color.yellow("Action: review recommended before execution.");
  }
  return color.red("Action: blocked unless --force is supplied.");
}

function colorSeverity(severity, color) {
  if (severity === "critical" || severity === "high") {
    return color.red;
  }
  if (severity === "medium") {
    return color.yellow;
  }
  return color.dim;
}

function formatDownloads(value) {
  return typeof value === "number" ? value.toLocaleString("en-US") : "unknown";
}

function pluralize(word, count) {
  return Number(count) === 1 ? word : `${word}s`;
}

function formatMaintainers(profile) {
  if (typeof profile.maintainersCount === "number") {
    const names = (profile.maintainers ?? []).slice(0, 3).map((person) => person.name).filter(Boolean);
    return names.length ? `${profile.maintainersCount} (${names.join(", ")}${profile.maintainersCount > names.length ? ", …" : ""})` : String(profile.maintainersCount);
  }
  return "unknown";
}

function formatDays(value) {
  if (value === null || value === undefined) {
    return "unknown";
  }
  if (value < 1) {
    return "<1d";
  }
  return `${Math.floor(value)}d`;
}

function formatDate(value) {
  if (!value) {
    return "unknown";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return date.toISOString().slice(0, 10);
}

function formatCount(value) {
  return typeof value === "number" ? value.toLocaleString("en-US") : "unknown";
}

function trim(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function createColor(enabled) {
  const wrap = (open, close) => (value) => (enabled ? `${open}${value}${close}` : String(value));
  return {
    green: wrap("\x1b[32m", "\x1b[0m"),
    yellow: wrap("\x1b[33m", "\x1b[0m"),
    red: wrap("\x1b[31m", "\x1b[0m"),
    dim: wrap("\x1b[2m", "\x1b[0m"),
  };
}