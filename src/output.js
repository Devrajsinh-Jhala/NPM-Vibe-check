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
  lines.push(...reviewHistoryLines(result.history, color));

  if (result.ai.status === "ok") {
    const profile = result.ai.modelSource?.startsWith("profile:") ? ` [${result.ai.modelProfile}]` : "";
    lines.push(`AI review: ${result.ai.providerLabel ?? result.ai.provider} ${result.ai.model}${profile} (${result.ai.confidence} confidence)`);
    const verified = result.ai.findings.filter((finding) => finding.evidenceVerified).length;
    const unsupported = result.ai.unsupportedFindingCount ?? 0;
    lines.push(`AI evidence: ${verified} source-backed ${pluralize("finding", verified)}${unsupported ? `; ${unsupported} unsupported omitted` : ""}`);
  } else if (result.ai.status === "skipped") {
    lines.push(`AI review: skipped (${result.ai.reason})`);
  } else {
    const target = result.ai.model
      ? `${result.ai.providerLabel ?? result.ai.provider} ${result.ai.model}: `
      : "";
    lines.push(`AI review: unavailable (${target}${trim(result.ai.reason, 240)})`);
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
    lines.push(`AI interpretation: ${result.ai.summary}`);
  }

  const aiFindings = result.ai.status === "ok"
    ? result.ai.findings.filter((finding) => finding.evidenceVerified).slice(0, 6)
    : [];
  if (aiFindings.length) {
    lines.push("");
    lines.push("AI source-backed findings:");
    for (const finding of aiFindings) {
      const location = finding.file ? ` in ${finding.file}${finding.line ? `:${finding.line}` : ""}` : "";
      const marker = colorSeverity(finding.severity, color)(finding.severity.toUpperCase().padEnd(8));
      lines.push(`- ${marker}${location}`);
      lines.push(`  Evidence: ${trim(finding.evidence, 180)}`);
      lines.push(`  ${trim(finding.rationale, 220)}`);
    }
  }

  lines.push("");
  lines.push(actionLine(result, color));
  return `${lines.join("\n")}\n`;
}

export function toJsonResult(result) {
  return JSON.stringify(result, null, 2);
}

export function toAgentResult(report, options = {}) {
  return JSON.stringify(createAgentResult(report, options), null, 2);
}

export function createAgentResult(report, options = {}) {
  const kind = options.kind === "project-scan" ? "project-scan" : "package-scan";
  const exitCode = Number(options.exitCode ?? 1);
  const incomplete = exitCode === 1;
  const verdict = report?.verdict?.verdict ?? null;
  const riskScore = Number.isFinite(Number(report?.verdict?.score))
    ? Number(report.verdict.score)
    : null;

  return {
    schemaVersion: 1,
    tool: {
      name: "npx-vibe",
      version: options.version ?? "unknown",
    },
    kind,
    status: incomplete ? "incomplete" : "complete",
    decision: agentDecision(verdict, riskScore, exitCode, incomplete),
    subject: kind === "project-scan"
      ? {
          type: "project",
          name: report?.project?.name ?? null,
          version: report?.project?.version ?? null,
          manifestPath: report?.project?.manifestPath ?? null,
        }
      : {
          type: "package",
          name: report?.package?.name ?? null,
          requested: report?.package?.requested ?? null,
          version: report?.package?.version ?? null,
        },
    report,
  };
}

export function toAgentError(error, options = {}) {
  return JSON.stringify(createAgentError(error, options), null, 2);
}

export function createAgentError(error, options = {}) {
  return {
    schemaVersion: 1,
    tool: {
      name: "npx-vibe",
      version: options.version ?? "unknown",
    },
    kind: "error",
    status: "error",
    decision: agentDecision(null, null, 1, true),
    error: {
      code: options.code ?? "operational_error",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function agentDecision(verdict, riskScore, exitCode, incomplete) {
  const action = incomplete
    ? "retry"
    : verdict === "proceed"
      ? "continue"
      : verdict === "caution"
        ? "review"
        : "stop";

  return {
    verdict,
    riskScore,
    action,
    exitCode,
    mayContinue: action === "continue",
    safeToExecute: action === "continue",
    requiresApproval: action === "review",
    requiresHumanReview: action === "review" || action === "retry",
    blocked: action === "stop",
    mustStop: action === "stop" || action === "retry",
  };
}

export function renderProjectDashboard(scan, options = {}) {
  const color = createColor(Boolean(options.color));
  const verdict = scan.verdict.verdict;
  const incomplete = scan.errors.length > 0;
  const headline = incomplete
    ? color.red("Incomplete")
    : verdict === "proceed"
    ? color.green("Proceed")
    : verdict === "caution"
      ? color.yellow("Caution")
      : color.red("Block");
  const symbol = incomplete ? "!" : SYMBOLS[verdict];
  const version = scan.project.version ? `@${scan.project.version}` : "";
  const lines = [
    `${symbol} npx-vibe project: ${headline}  ${color.dim(`highest risk ${scan.verdict.score}/100`)}`,
    `${scan.project.name}${version}`,
    color.dim(scan.project.manifestPath),
    "",
    `Scanned: ${scan.summary.scanned}/${scan.summary.discovered} direct dependencies  ` +
      `Proceed: ${scan.summary.proceed}  Caution: ${scan.summary.caution}  Block: ${scan.summary.block}`,
    `Scope: dependencies + optionalDependencies${scan.project.includeDev ? " + devDependencies" : ""}`,
    `Resolution: ${scan.project.lockfilePath
      ? "exact versions from package-lock.json when available"
      : scan.project.lockfileError
        ? "package.json ranges (package-lock.json could not be read)"
        : "package.json ranges (no package-lock.json found)"}`,
  ];

  if (scan.project.lockfileError) {
    lines.push(color.yellow(`Lockfile warning: ${trim(scan.project.lockfileError, 180)}`));
  }
  if (scan.ai.enabled) {
    lines.push(`AI budget: ${scan.ai.attempted}/${scan.ai.limit} triggered ${pluralize("review", scan.ai.attempted)}` +
      `${scan.ai.suppressed ? `; ${scan.ai.suppressed} additional trigger(s) used heuristics only` : ""}`);
  } else {
    lines.push("AI review: off (heuristic-only)");
  }

  if (scan.packages.length) {
    lines.push("", "Packages:");
    const packages = [...scan.packages].sort((left, right) =>
      Number(right.verdict.score) - Number(left.verdict.score) || left.package.name.localeCompare(right.package.name)
    );
    for (const result of packages) {
      const label = result.verdict.verdict.toUpperCase().padEnd(7);
      const styled = result.verdict.verdict === "block"
        ? color.red(label)
        : result.verdict.verdict === "caution"
          ? color.yellow(label)
          : color.green(label);
      const findings = prioritizedFindings(result.findings);
      const signals = findings.slice(0, 3).map((finding) => finding.code).join(", ") || "no deterministic findings";
      lines.push(`- ${styled} ${String(result.verdict.score).padStart(3)}/100  ${result.package.name}@${result.package.version}`);
      lines.push(color.dim(`  ${signals}`));
      if (result.verdict.verdict !== "proceed") {
        for (const finding of findings.slice(0, 2)) {
          lines.push(`  ${finding.code}${finding.file ? ` in ${finding.file}` : ""}: ${trim(finding.detail, 150)}`);
          const evidence = finding.evidence?.[0];
          if (evidence?.excerpt) {
            lines.push(color.dim(`  Evidence${evidence.line ? ` line ${evidence.line}` : ""}: ${trim(evidence.excerpt, 150)}`));
          }
        }
      }
    }
  }

  if (scan.skipped.length) {
    lines.push("", "Skipped:");
    for (const dependency of scan.skipped.slice(0, 10)) {
      lines.push(`- ${dependency.name}@${dependency.requested}: ${dependency.reason}`);
    }
    if (scan.skipped.length > 10) {
      lines.push(`- ... ${scan.skipped.length - 10} more skipped dependencies`);
    }
  }

  if (scan.errors.length) {
    lines.push("", "Errors:");
    for (const error of scan.errors.slice(0, 10)) {
      lines.push(color.red(`- ${error.name}@${error.requested}: ${trim(error.message, 200)}`));
    }
  }

  lines.push("", color.dim("No dependency or package code was executed during this project scan."));
  if (scan.errors.length) {
    lines.push(color.red("Action: fix scan errors before relying on the aggregate verdict."));
  } else if (verdict === "proceed") {
    lines.push(color.green("Action: no reviewable direct dependency triggered Caution or Block."));
  } else if (verdict === "caution") {
    lines.push(color.yellow("Action: review the flagged dependencies and their evidence individually."));
  } else {
    lines.push(color.red("Action: investigate blocked dependencies before install or execution."));
  }
  return `${lines.join("\n")}\n`;
}

export function renderGitHubActionsAnnotations(scan) {
  const lines = [];
  for (const result of scan.packages) {
    if (result.verdict.verdict === "proceed") {
      continue;
    }
    const level = result.verdict.verdict === "block" ? "error" : "warning";
    const signals = prioritizedFindings(result.findings).slice(0, 3).map((finding) => finding.code).join(", ") || "review required";
    const title = escapeWorkflowProperty(`npx-vibe: ${result.package.name}`);
    const message = escapeWorkflowMessage(
      `${capitalize(result.verdict.verdict)} ${result.verdict.score}/100 for ${result.package.name}@${result.package.version}: ${signals}`
    );
    lines.push(`::${level} title=${title}::${message}`);
  }
  for (const error of scan.errors) {
    lines.push(`::error title=${escapeWorkflowProperty(`npx-vibe: ${error.name}`)}::${escapeWorkflowMessage(error.message)}`);
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

export function renderProjectMarkdownSummary(scan) {
  const title = `npx-vibe: ${scan.errors.length ? "Incomplete" : capitalize(scan.verdict.verdict)}`;
  const lines = [
    `## ${title}`,
    "",
    `Scanned **${scan.summary.scanned}** of **${scan.summary.discovered}** direct dependencies without executing package code.`,
    "",
    `- Proceed: **${scan.summary.proceed}**`,
    `- Caution: **${scan.summary.caution}**`,
    `- Block: **${scan.summary.block}**`,
    `- Skipped: **${scan.summary.skipped}**`,
    `- Errors: **${scan.summary.errors}**`,
    "",
    "| Package | Resolved version | Verdict | Risk | Signals |",
    "| --- | --- | --- | ---: | --- |",
  ];

  const packages = [...scan.packages].sort((left, right) =>
    Number(right.verdict.score) - Number(left.verdict.score) || left.package.name.localeCompare(right.package.name)
  );
  for (const result of packages) {
    const signals = prioritizedFindings(result.findings).slice(0, 3).map((finding) => finding.code).join(", ") || "none";
    lines.push(`| ${markdownCell(result.package.name)} | ${markdownCell(result.package.version)} | ${capitalize(result.verdict.verdict)} | ${result.verdict.score}/100 | ${markdownCell(signals)} |`);
  }
  if (!packages.length) {
    lines.push("| _No registry dependencies scanned_ | - | Proceed | 0/100 | none |");
  }
  lines.push("");
  if (scan.skipped.length) {
    lines.push("Skipped non-registry dependencies are listed in the CLI and JSON output.", "");
  }
  lines.push("_A npx-vibe verdict is a review aid, not proof that a package is safe or malicious._", "");
  return lines.join("\n");
}

function escapeWorkflowMessage(value) {
  return String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeWorkflowProperty(value) {
  return escapeWorkflowMessage(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function prioritizedFindings(findings = []) {
  const ranks = { critical: 4, high: 3, medium: 2, low: 1 };
  return [...findings].sort((left, right) =>
    (ranks[right.severity] ?? 0) - (ranks[left.severity] ?? 0)
  );
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

function reviewHistoryLines(history, color) {
  if (!history || history.status === "disabled") {
    return [];
  }
  const saveWarning = history.saveWarning
    ? [color.dim(`Review memory: result was not saved (${trim(history.saveWarning, 140)})`)]
    : [];
  if (history.status === "unavailable") {
    return [color.dim(`Review memory: unavailable (${trim(history.reason, 140)})`), ...saveWarning];
  }
  if (history.status === "first-review") {
    return ["Review memory: first local scan of this package integrity.", ...saveWarning];
  }
  if (history.status === "unchanged") {
    return [
      `Review memory: unchanged tarball since ${formatDate(history.reviewedAt)}; previous ${capitalize(history.previousVerdict)} ${history.previousScore}/100.`,
      ...saveWarning,
    ];
  }

  const changes = history.changes ?? {};
  const fileChanges = (changes.addedFiles?.length ?? 0) + (changes.removedFiles?.length ?? 0) + (changes.changedFiles?.length ?? 0);
  return [
    `Version comparison: ${history.previousVersion ?? "previous review"} → current; integrity changed.`,
    color.dim(
      `${fileChanges} selected ${pluralize("file", fileChanges)} changed; ` +
      `findings +${changes.addedFindings?.length ?? 0}/-${changes.resolvedFindings?.length ?? 0}; ` +
      `install hooks ${changes.lifecycleScriptsChanged ? "changed" : "unchanged"}.`
    ),
    ...saveWarning,
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

function capitalize(value) {
  const text = String(value ?? "unknown");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
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
