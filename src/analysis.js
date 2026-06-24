const LIFECYCLE_SCRIPT_NAMES = [
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "preprepare",
  "prepare",
  "postprepare",
];

const DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "devDependencies",
  "bundleDependencies",
  "bundledDependencies",
];

const SECRET_PATTERNS = [
  /NPM_TOKEN|NODE_AUTH_TOKEN|GITHUB_TOKEN|GH_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|GOOGLE_APPLICATION_CREDENTIALS|AZURE_CLIENT_SECRET/i,
  /npmrc|\.ssh|id_rsa|id_ed25519/i,
];

const NETWORK_PATTERNS = [
  /\bfetch\s*\(/,
  /\baxios\b/,
  /\brequest\s*\(/,
  /\bhttps?\.request\s*\(/,
  /\bhttps?\.get\s*\(/,
  /\bnet\.connect\s*\(/,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bInvoke-WebRequest\b/i,
  /\biwr\b/i,
  /https?:\/\/[^\s"'`]+/i,
];

const SHELL_PATTERNS = [
  /\bexec(File|Sync)?\s*\(/,
  /\bspawn(Sync)?\s*\(/,
  /child_process/,
  /\bbash\b/i,
  /\bsh\s+-c\b/i,
  /\bpowershell\b/i,
  /\bcmd\.exe\b/i,
];

const OBFUSCATION_PATTERNS = [
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bvm\.runIn(NewContext|ThisContext|Context)\s*\(/,
  /\batob\s*\(/,
  /\bBuffer\.from\s*\([^,\n]+,\s*["']base64["']\s*\)/,
  /\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){10,}/,
  /[A-Za-z0-9+/]{180,}={0,2}/,
];

const OUTSIDE_WRITE_PATTERNS = [
  /writeFile(Sync)?\s*\([^)]*(?:process\.env\.HOME|homedir|USERPROFILE|APPDATA)/,
  /appendFile(Sync)?\s*\([^)]*(?:\.bashrc|\.zshrc|\.profile|\.npmrc|authorized_keys|known_hosts)/,
  /\bchmod\s+.*(?:\.ssh|authorized_keys|id_rsa|id_ed25519)/i,
];

const ENV_ENUMERATION_PATTERNS = [
  /JSON\.stringify\s*\(\s*process\.env\s*\)/,
  /Object\.(?:keys|entries|values)\s*\(\s*process\.env\s*\)/,
  /for\s*\([^)]*\bin\s+process\.env\s*\)/,
  /(?:printenv|set|env)\s*(?:\||>|$)/i,
];

export function analyzePackage(snapshot, tarballInspection, options = {}) {
  const manifest = tarballInspection.packageJson ?? snapshot.manifest;
  const ageThresholdDays = Number(options.ageDays ?? 14);
  const downloadsThreshold = Number(options.downloadsThreshold ?? 1_000);
  const findings = [...(tarballInspection.findings ?? [])];

  const packageAgeDays = daysSince(snapshot.packageCreatedAt);
  const versionAgeDays = daysSince(snapshot.versionPublishedAt);
  const weeklyDownloads = typeof snapshot.downloads?.downloads === "number" ? snapshot.downloads.downloads : null;

  if (packageAgeDays !== null && packageAgeDays < ageThresholdDays) {
    findings.push({
      severity: "low",
      code: "young_package",
      file: null,
      detail: `Package was created ${formatDays(packageAgeDays)} ago.`,
    });
  }

  if (versionAgeDays !== null && versionAgeDays < ageThresholdDays) {
    findings.push({
      severity: "low",
      code: "young_version",
      file: null,
      detail: `This version was published ${formatDays(versionAgeDays)} ago.`,
    });
  }

  if (weeklyDownloads !== null && weeklyDownloads < downloadsThreshold) {
    findings.push({
      severity: "low",
      code: "low_downloads",
      file: null,
      detail: `Package had ${weeklyDownloads.toLocaleString("en-US")} downloads last week.`,
    });
  }

  if (weeklyDownloads === null) {
    findings.push({
      severity: "low",
      code: "downloads_unavailable",
      file: null,
      detail: `Could not load npm download counts${snapshot.downloads?.error ? `: ${snapshot.downloads.error}` : "."}`,
    });
  }

  const lifecycleScripts = lifecycleScriptEntries(manifest);
  for (const script of lifecycleScripts) {
    findings.push({
      severity: "medium",
      code: "lifecycle_hook",
      file: "package.json",
      detail: `${script.name} runs: ${script.command}`,
      evidence: [{ line: null, excerpt: `${script.name}: ${script.command}` }],
    });
    findings.push(...analyzeText(script.command, `package.json#scripts.${script.name}`, { isLifecycleCommand: true }));
  }

  findings.push(...dependencyProtocolFindings(manifest));

  for (const file of tarballInspection.selectedFiles ?? []) {
    findings.push(...analyzeText(file.text, file.path, {
      isLifecycleCommand: false,
      reviewReasons: file.reasons ?? [],
    }));
    if (/(package-lock\.json|npm-shrinkwrap\.json)$/i.test(file.path) && /"hasInstallScript"\s*:\s*true/.test(file.text)) {
      findings.push({
        severity: "medium",
        code: "transitive_install_script",
        file: file.path,
        detail: "Lockfile references at least one dependency with an install script. Transitive package code was not fully reviewed.",
        evidence: evidenceForPatterns(file.text, [/"hasInstallScript"\s*:\s*true/]),
      });
    }
  }

  const staticScore = scoreFindings(findings);
  const needsAi = shouldAskAi(findings);

  return {
    manifest,
    stats: {
      packageAgeDays,
      versionAgeDays,
      weeklyDownloads,
      lifecycleScripts,
      selectedFileCount: tarballInspection.selectedFiles?.length ?? 0,
      fileCount: tarballInspection.fileCount,
      totalUnpackedBytes: tarballInspection.totalUnpackedBytes,
      trustContext: buildTrustContext(snapshot, packageAgeDays, weeklyDownloads),
    },
    findings: dedupeFindings(findings),
    staticScore,
    needsAi,
  };
}

export function scoreFindings(findings) {
  if (findings.some((finding) => finding.severity === "critical")) {
    return 100;
  }

  const uniqueByCode = new Map();
  for (const finding of findings) {
    if (!uniqueByCode.has(finding.code)) {
      uniqueByCode.set(finding.code, finding);
    }
  }

  const unique = Array.from(uniqueByCode.values());
  const highCount = unique.filter((finding) => finding.severity === "high").length;
  const mediumCount = unique.filter((finding) => finding.severity === "medium").length;
  const lowCount = unique.filter((finding) => finding.severity === "low").length;

  if (highCount > 0) {
    return Math.min(68, 55 + (highCount - 1) * 5 + mediumCount * 3 + lowCount);
  }

  if (mediumCount > 0) {
    return Math.min(60, 38 + (mediumCount - 1) * 4 + lowCount);
  }

  return Math.min(30, lowCount * 5);
}

export function shouldAskAi(findings) {
  const codes = new Set(findings.map((finding) => finding.code));
  if (findings.some((finding) => finding.severity === "high" || finding.severity === "critical")) {
    return true;
  }
  if (codes.has("lifecycle_hook")) {
    return true;
  }
  if ((codes.has("young_package") || codes.has("young_version")) && codes.has("low_downloads")) {
    return true;
  }
  return false;
}

export function addAiUnavailableFinding(analysis, reason) {
  return {
    ...analysis,
    findings: [
      ...analysis.findings,
      {
        severity: "medium",
        code: "ai_unavailable",
        file: null,
        detail: `AI review was needed but unavailable: ${reason}`,
      },
    ],
    staticScore: Math.max(analysis.staticScore, 46),
  };
}

function analyzeText(text, file, context) {
  const findings = [];
  const source = String(text ?? "");
  const secretEvidence = evidenceForPatterns(source, [...SECRET_PATTERNS, ...ENV_ENUMERATION_PATTERNS]);
  const networkEvidence = evidenceForPatterns(source, NETWORK_PATTERNS);
  const shellEvidence = evidenceForPatterns(source, SHELL_PATTERNS);
  const obfuscationEvidence = evidenceForPatterns(source, OBFUSCATION_PATTERNS);
  const outsideWriteEvidence = evidenceForPatterns(source, OUTSIDE_WRITE_PATTERNS);
  const downloadEvidence = evidenceForPatterns(source, [/\b(curl|wget|Invoke-WebRequest|iwr)\b/i]);
  const pipeEvidence = evidenceForPatterns(source, [/\b(curl|wget)\b[\s\S]{0,160}\|\s*(?:sh|bash|node|python|perl|ruby)/i]);

  const hasSecretAccess = secretEvidence.length > 0;
  const hasNetwork = networkEvidence.length > 0;
  const hasShell = shellEvidence.length > 0;
  const hasObfuscation = obfuscationEvidence.length > 0;
  const hasOutsideWrite = outsideWriteEvidence.length > 0;
  const hasDownloadCommand = downloadEvidence.length > 0;
  const pipesToShell = pipeEvidence.length > 0;
  const installRelatedFile = (context.reviewReasons ?? []).some((reason) => /(?:pre|post)?install|setup|prepare|suspicious/i.test(reason));
  const networkAndShellAreRelated = installRelatedFile || patternGroupsAreNear(source, NETWORK_PATTERNS, SHELL_PATTERNS, 800);

  if (hasSecretAccess && hasNetwork) {
    findings.push({
      severity: "critical",
      code: "possible_secret_exfiltration",
      file,
      detail: "Code appears to access environment/secrets and perform network activity.",
      evidence: mergeEvidence(secretEvidence, networkEvidence),
    });
  }

  if (pipesToShell || (hasDownloadCommand && hasShell)) {
    findings.push({
      severity: "critical",
      code: "download_and_execute",
      file,
      detail: "Command appears to download external content and execute it.",
      evidence: pipesToShell ? pipeEvidence : mergeEvidence(downloadEvidence, shellEvidence),
    });
  }

  if (context.isLifecycleCommand && hasNetwork) {
    findings.push({
      severity: "high",
      code: "network_in_install_hook",
      file,
      detail: "Install lifecycle command performs network activity.",
      evidence: networkEvidence,
    });
  }

  if (context.isLifecycleCommand && hasShell) {
    findings.push({
      severity: "medium",
      code: "shell_in_install_hook",
      file,
      detail: "Install lifecycle command spawns a shell or child process.",
      evidence: shellEvidence,
    });
  }

  if (hasObfuscation) {
    findings.push({
      severity: hasNetwork || hasSecretAccess ? "high" : "medium",
      code: "obfuscated_code",
      file,
      detail: "Code contains eval/dynamic execution, base64-like payloads, or other obfuscation signals.",
      evidence: obfuscationEvidence,
    });
  }

  if (hasOutsideWrite) {
    findings.push({
      severity: "high",
      code: "suspicious_home_write",
      file,
      detail: "Code appears to write to user home, shell profile, npm credentials, or SSH files.",
      evidence: outsideWriteEvidence,
    });
  }

  if (!context.isLifecycleCommand && hasShell && hasNetwork && networkAndShellAreRelated) {
    findings.push({
      severity: "medium",
      code: "network_and_shell",
      file,
      detail: "Code combines network access with shell execution.",
      evidence: mergeEvidence(networkEvidence, shellEvidence),
    });
  }

  const minerEvidence = evidenceForPatterns(source, [/crypto(?:miner|night)|xmrig|stratum\+tcp/i]);
  if (minerEvidence.length) {
    findings.push({
      severity: "critical",
      code: "possible_cryptominer",
      file,
      detail: "Code contains cryptomining indicators.",
      evidence: minerEvidence,
    });
  }

  return findings;
}

function dependencyProtocolFindings(manifest) {
  const findings = [];
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = manifest?.[field];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      continue;
    }
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range === "string" && /^(git\+|https?:|file:)/i.test(range)) {
        findings.push({
          severity: "medium",
          code: "unusual_dependency_protocol",
          file: "package.json",
          detail: `${field}.${name} uses ${range}.`,
          evidence: [{ line: null, excerpt: `${field}.${name}: ${range}` }],
        });
      }
    }
  }
  return findings;
}

function lifecycleScriptEntries(manifest) {
  const scripts = manifest?.scripts ?? {};
  return LIFECYCLE_SCRIPT_NAMES.flatMap((name) => {
    const command = scripts[name];
    return typeof command === "string" && command.trim() ? [{ name, command }] : [];
  });
}

function buildTrustContext(snapshot, packageAgeDays, weeklyDownloads) {
  const signals = [];
  if (packageAgeDays !== null && packageAgeDays >= 365) {
    signals.push("long registry history");
  }
  if (weeklyDownloads !== null && weeklyDownloads >= 100_000) {
    signals.push("high weekly adoption");
  }
  if ((snapshot.profile?.maintainersCount ?? 0) >= 2) {
    signals.push("multiple maintainers");
  }
  if (snapshot.profile?.repository?.github) {
    signals.push("linked GitHub repository");
  }

  return {
    level: signals.length >= 2 ? "established-signals" : "limited-signals",
    signals,
    note: "Registry popularity and age provide context, but never override code findings.",
  };
}

function evidenceForPatterns(source, patterns) {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(source);
    if (match) {
      return [evidenceAt(source, match.index, match[0])];
    }
  }
  return [];
}

function evidenceAt(source, index, matchedText) {
  const line = source.slice(0, index).split("\n").length;
  const start = Math.max(0, index - 30);
  const end = Math.min(source.length, index + Math.max(matchedText.length, 1) + 110);
  const excerpt = source
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
  return { line, excerpt };
}

function patternGroupsAreNear(source, firstPatterns, secondPatterns, maxDistance) {
  const firstIndexes = patternIndexes(source, firstPatterns);
  const secondIndexes = patternIndexes(source, secondPatterns);
  return firstIndexes.some((first) => secondIndexes.some((second) => Math.abs(first - second) <= maxDistance));
}

function patternIndexes(source, patterns) {
  const indexes = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const matcher = new RegExp(pattern.source, flags);
    let match;
    while ((match = matcher.exec(source)) !== null && indexes.length < 40) {
      indexes.push(match.index);
      if (match[0].length === 0) {
        matcher.lastIndex += 1;
      }
    }
  }
  return indexes;
}

function mergeEvidence(...groups) {
  const seen = new Set();
  const merged = [];
  for (const evidence of groups.flat()) {
    const key = `${evidence.line}:${evidence.excerpt}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(evidence);
    }
  }
  return merged.slice(0, 2);
}

function daysSince(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return Math.max(0, (Date.now() - date.getTime()) / 86_400_000);
}

function formatDays(days) {
  if (days < 1) {
    return "less than 1 day";
  }
  return `${Math.floor(days)} day${Math.floor(days) === 1 ? "" : "s"}`;
}

function dedupeFindings(findings) {
  const seen = new Set();
  const results = [];
  for (const finding of findings) {
    const key = `${finding.severity}:${finding.code}:${finding.file}:${finding.detail}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(finding);
  }
  return results;
}
