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
  /child_process/,
  /\bexec(File|Sync)?\s*\(/,
  /\bspawn(Sync)?\s*\(/,
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
    });
    findings.push(...analyzeText(script.command, `package.json#scripts.${script.name}`, { isLifecycleCommand: true }));
  }

  findings.push(...dependencyProtocolFindings(manifest));

  for (const file of tarballInspection.selectedFiles ?? []) {
    findings.push(...analyzeText(file.text, file.path, { isLifecycleCommand: false }));
    if (/(package-lock\.json|npm-shrinkwrap\.json)$/i.test(file.path) && /"hasInstallScript"\s*:\s*true/.test(file.text)) {
      findings.push({
        severity: "medium",
        code: "transitive_install_script",
        file: file.path,
        detail: "Lockfile references at least one dependency with an install script. Transitive package code was not fully reviewed.",
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

  const hasSecretAccess = SECRET_PATTERNS.some((pattern) => pattern.test(source)) || ENV_ENUMERATION_PATTERNS.some((pattern) => pattern.test(source));
  const hasNetwork = NETWORK_PATTERNS.some((pattern) => pattern.test(source));
  const hasShell = SHELL_PATTERNS.some((pattern) => pattern.test(source));
  const hasObfuscation = OBFUSCATION_PATTERNS.some((pattern) => pattern.test(source));
  const hasOutsideWrite = OUTSIDE_WRITE_PATTERNS.some((pattern) => pattern.test(source));
  const hasDownloadCommand = /\b(curl|wget|Invoke-WebRequest|iwr)\b/i.test(source);
  const pipesToShell = /\b(curl|wget)\b[\s\S]{0,160}\|\s*(?:sh|bash|node|python|perl|ruby)/i.test(source);

  if (hasSecretAccess && hasNetwork) {
    findings.push({
      severity: "critical",
      code: "possible_secret_exfiltration",
      file,
      detail: "Code appears to access environment/secrets and perform network activity.",
    });
  }

  if (pipesToShell || (hasDownloadCommand && hasShell)) {
    findings.push({
      severity: "critical",
      code: "download_and_execute",
      file,
      detail: "Command appears to download external content and execute it.",
    });
  }

  if (context.isLifecycleCommand && hasNetwork) {
    findings.push({
      severity: "high",
      code: "network_in_install_hook",
      file,
      detail: "Install lifecycle command performs network activity.",
    });
  }

  if (context.isLifecycleCommand && hasShell) {
    findings.push({
      severity: "medium",
      code: "shell_in_install_hook",
      file,
      detail: "Install lifecycle command spawns a shell or child process.",
    });
  }

  if (hasObfuscation) {
    findings.push({
      severity: hasNetwork || hasSecretAccess ? "high" : "medium",
      code: "obfuscated_code",
      file,
      detail: "Code contains eval/dynamic execution, base64-like payloads, or other obfuscation signals.",
    });
  }

  if (hasOutsideWrite) {
    findings.push({
      severity: "high",
      code: "suspicious_home_write",
      file,
      detail: "Code appears to write to user home, shell profile, npm credentials, or SSH files.",
    });
  }

  if (!context.isLifecycleCommand && hasShell && hasNetwork) {
    findings.push({
      severity: "medium",
      code: "network_and_shell",
      file,
      detail: "Code combines network access with shell execution.",
    });
  }

  if (/crypto(?:miner|night)|xmrig|stratum\+tcp/i.test(source)) {
    findings.push({
      severity: "critical",
      code: "possible_cryptominer",
      file,
      detail: "Code contains cryptomining indicators.",
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
