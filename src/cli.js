import { spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { packageVersion } from "./version.js";
import { parsePackageSpec } from "./spec.js";
import { loadPackageSnapshot, downloadTarball, verifyTarball } from "./registry.js";
import { inspectTarball } from "./tarball.js";
import { analyzePackage, addAiUnavailableFinding } from "./analysis.js";
import { maybeRunAiReview } from "./ai.js";
import { decideVerdict, checkExitCode } from "./verdict.js";
import {
  renderDashboard,
  renderGitHubActionsAnnotations,
  renderProjectDashboard,
  renderProjectMarkdownSummary,
  renderScriptApprovalAnnotations,
  renderScriptApprovals,
  toAgentError,
  toAgentResult,
  toJsonResult,
} from "./output.js";
import { formatProviderCatalog } from "./providers.js";
import { loadProjectManifest, projectExitCode, scanProject } from "./project.js";
import {
  applyAllowScripts,
  buildAllowScriptsPatch,
  reviewScriptApprovals,
  scriptApprovalExitCode,
} from "./scripts.js";
import {
  compareReviewMemory,
  createReviewFingerprint,
  loadReviewMemory,
  saveReviewMemory,
} from "./history.js";

export async function main(argv = process.argv.slice(2)) {
  try {
    if (argv[0] === "--mcp") {
      if (argv.length > 1) {
        if (argv.length === 2 && ["--help", "-h"].includes(argv[1])) {
          console.log(mcpHelpText());
          process.exitCode = 0;
          return;
        }
        throw new Error("--mcp does not accept CLI scan arguments. Configure scans through MCP tools.");
      }
      const { startMcpServer } = await import("./mcp.js");
      process.exitCode = await startMcpServer();
      return;
    }
    const exitCode = await run(argv);
    process.exitCode = exitCode;
  } catch (error) {
    if (argvRequestsAgent(argv)) {
      console.log(toAgentError(error, { version: packageVersion() }));
    } else {
      console.error(`npx-vibe: ${error.message}`);
    }
    process.exitCode = 1;
  }
}

export async function run(argv, env = process.env) {
  const config = parseArgs(argv, env);

  if (config.command === "approve-scripts" && !config.help && !config.version && !config.models) {
    return runApproveScripts(config, env);
  }

  if (config.help) {
    console.log(helpText());
    return 0;
  }

  if (config.version) {
    console.log(packageVersion());
    return 0;
  }

  if (config.models) {
    console.log(formatProviderCatalog());
    return 0;
  }

  if (config.projectPath) {
    const scan = await scanProject(config.projectPath, config, reviewPackage);
    const exitCode = projectExitCode(scan);
    if (config.agent) {
      console.log(toAgentResult(scan, {
        kind: "project-scan",
        exitCode,
        version: packageVersion(),
      }));
    } else if (config.json) {
      console.log(toJsonResult(scan));
    } else {
      process.stdout.write(renderProjectDashboard(scan, {
        color: config.color && process.stdout.isTTY,
      }));
    }
    if (config.ci && env.GITHUB_ACTIONS === "true") {
      process.stdout.write(renderGitHubActionsAnnotations(scan));
      if (env.GITHUB_STEP_SUMMARY) {
        appendFileSync(env.GITHUB_STEP_SUMMARY, renderProjectMarkdownSummary(scan), "utf8");
      }
    }
    return exitCode;
  }

  const { result, manifest, snapshot } = await reviewPackage(config.packageSpec, config);

  const exitCode = checkExitCode(result.verdict.verdict);
  if (config.agent) {
    console.log(toAgentResult(result, {
      kind: "package-scan",
      exitCode,
      version: packageVersion(),
    }));
    return exitCode;
  }

  if (config.json) {
    console.log(toJsonResult(result));
    return exitCode;
  }

  process.stdout.write(renderDashboard(result, {
    color: config.color && process.stdout.isTTY,
  }));

  if (config.command !== "run") {
    return exitCode;
  }

  const permitted = await confirmExecution(result, config);
  if (!permitted) {
    return checkExitCode(result.verdict.verdict);
  }

  return executePackage(snapshot, manifest, config.packageArgs, config);
}

async function runApproveScripts(config, env) {
  const project = loadProjectManifest(config.projectPath, config);
  const report = await reviewScriptApprovals(project, config, reviewPackage);
  const exitCode = scriptApprovalExitCode(report);

  if (config.write) {
    report.write = applyAllowScripts(project.manifestPath, buildAllowScriptsPatch(report, config));
  }

  if (config.agent) {
    console.log(toAgentResult(report, {
      kind: "script-approvals",
      exitCode,
      version: packageVersion(),
    }));
    return exitCode;
  }

  if (config.json) {
    console.log(toJsonResult(report));
    return exitCode;
  }

  process.stdout.write(renderScriptApprovals(report, {
    color: config.color && process.stdout.isTTY,
  }));

  if (config.ci && env.GITHUB_ACTIONS === "true") {
    process.stdout.write(renderScriptApprovalAnnotations(report));
  }

  return exitCode;
}

export async function reviewPackage(packageSpecInput, config = {}) {
  const spec = parsePackageSpec(packageSpecInput);
  const snapshot = await loadPackageSnapshot(spec, config);
  const tarball = await downloadTarball(snapshot.tarball, config);
  const integrity = verifyTarball(tarball, snapshot);
  const tarballInspection = inspectTarball(tarball, config);

  if (!integrity.ok) {
    tarballInspection.findings.push({
      severity: "critical",
      code: "integrity_mismatch",
      file: null,
      detail: "Downloaded tarball did not match npm registry integrity metadata.",
    });
  }

  let analysis = analyzePackage(snapshot, tarballInspection, config);
  const memory = loadReviewMemory(config);
  const fingerprint = createReviewFingerprint(snapshot, integrity, analysis, tarballInspection);
  const reviewHistory = compareReviewMemory(memory, fingerprint);
  analysis = {
    ...analysis,
    stats: {
      ...analysis.stats,
      reviewHistory,
    },
  };
  const aiReview = await maybeRunAiReview(snapshot, analysis, tarballInspection, config);

  if (analysis.needsAi && aiReview.status === "unavailable") {
    analysis = addAiUnavailableFinding(analysis, aiReview.reason ?? "unknown reason");
  }

  const verdict = decideVerdict(analysis, aiReview, config);
  const binInfo = safeFindBinCommand(analysis.manifest, spec, config.bin);

  const result = {
    package: {
      name: spec.name,
      requested: spec.wanted,
      version: snapshot.version,
      tarball: snapshot.tarball,
      integrity: {
        checked: integrity.checked,
        ok: integrity.ok,
        key: fingerprint.integrityKey,
      },
      bin: binInfo.command,
    },
    profile: snapshot.profile,
    verdict,
    stats: analysis.stats,
    findings: analysis.findings,
    ai: sanitizeAiReview(aiReview),
    history: reviewHistory,
    execution: {
      npmPackage: `${spec.name}@${snapshot.version}`,
      bin: binInfo.command,
      installScripts: config.allowInstallScripts ? "allow-reviewed-root" : "ignored",
      binError: binInfo.error,
    },
  };
  const historyWrite = saveReviewMemory(memory, fingerprint, result);
  if (!historyWrite.saved && historyWrite.reason && historyWrite.reason !== "disabled") {
    result.history = {
      ...result.history,
      saveWarning: historyWrite.reason,
    };
  }

  return {
    snapshot,
    manifest: analysis.manifest,
    result,
  };
}

const SUBCOMMANDS = new Set(["run", "approve-scripts"]);

export function parseArgs(argv, env = process.env) {
  let command = "scan";
  if (SUBCOMMANDS.has(argv[0])) {
    command = argv[0];
    argv = argv.slice(1);
  }
  const aiModeExplicit = Boolean(env.NPX_VIBE_AI);
  const config = {
    aiMode: env.NPX_VIBE_AI ?? (env.NPX_VIBE_API_KEY ? "online" : "off"),
    aiModeExplicit,
    apiKey: env.NPX_VIBE_API_KEY,
    apiUrl: env.NPX_VIBE_API_URL,
    provider: env.NPX_VIBE_PROVIDER ?? env.NPX_VIBE_AI_PROVIDER ?? "auto",
    model: env.NPX_VIBE_MODEL,
    appUrl: env.NPX_VIBE_APP_URL,
    aiMaxTokens: numberFromEnv(env.NPX_VIBE_AI_MAX_TOKENS, 4_000),
    apiKeys: {
      NPX_VIBE_API_KEY: env.NPX_VIBE_API_KEY,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      GEMINI_API_KEY: env.GEMINI_API_KEY,
      GOOGLE_API_KEY: env.GOOGLE_API_KEY,
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
      GROQ_API_KEY: env.GROQ_API_KEY,
      TOGETHER_API_KEY: env.TOGETHER_API_KEY,
    },
    ollamaUrl: env.NPX_VIBE_OLLAMA_URL,
    ollamaModel: env.NPX_VIBE_OLLAMA_MODEL,
    registry: env.NPX_VIBE_REGISTRY,
    githubToken: env.NPX_VIBE_GITHUB_TOKEN ?? env.GITHUB_TOKEN ?? env.GH_TOKEN,
    ageDays: numberFromEnv(env.NPX_VIBE_AGE_DAYS, 14),
    downloadsThreshold: numberFromEnv(env.NPX_VIBE_DOWNLOADS, 1_000),
    cautionScore: numberFromEnv(env.NPX_VIBE_CAUTION_SCORE, 40),
    blockScore: numberFromEnv(env.NPX_VIBE_BLOCK_SCORE, 70),
    timeoutMs: numberFromEnv(env.NPX_VIBE_TIMEOUT_MS, 15_000),
    aiTimeoutMs: numberFromEnv(env.NPX_VIBE_AI_TIMEOUT_MS, 30_000),
    maxAiChars: numberFromEnv(env.NPX_VIBE_MAX_AI_CHARS, 120_000),
    advisories: env.NPX_VIBE_ADVISORIES !== "off",
    historyEnabled: env.NPX_VIBE_HISTORY !== "off",
    historyFile: env.NPX_VIBE_HISTORY_FILE,
    npmBin: env.NPX_VIBE_NPM_BIN,
    bin: env.NPX_VIBE_BIN,
    projectPath: undefined,
    projectConcurrency: boundedIntegerFromEnv(env.NPX_VIBE_CONCURRENCY, 3, 1, 8),
    projectAiLimit: boundedIntegerFromEnv(env.NPX_VIBE_AI_LIMIT, 3, 0, 100),
    projectMaxPackages: boundedIntegerFromEnv(env.NPX_VIBE_MAX_PACKAGES, 500, 1, 5_000),
    command,
    includeDev: false,
    transitive: true,
    transitiveExplicit: false,
    write: false,
    pin: false,
    all: false,
    ci: false,
    agent: false,
    check: false,
    json: false,
    models: false,
    yes: false,
    force: false,
    allowInstallScripts: false,
    color: !env.NO_COLOR,
    packageArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--") {
      if (!config.packageSpec) {
        throw new Error("Missing package spec before --.");
      }
      config.packageArgs = argv.slice(index + 1);
      break;
    }

    if (!config.packageSpec && token.startsWith("-")) {
      const parsed = splitOption(token);
      const readValue = () => {
        if (parsed.value !== undefined) {
          return parsed.value;
        }
        index += 1;
        if (index >= argv.length) {
          throw new Error(`Missing value for ${parsed.name}.`);
        }
        return argv[index];
      };

      switch (parsed.name) {
        case "-h":
        case "--help":
          config.help = true;
          break;
        case "-v":
        case "--version":
          config.version = true;
          break;
        case "--check":
          config.check = true;
          break;
        case "--json":
          config.json = true;
          config.check = true;
          break;
        case "--agent":
          config.agent = true;
          config.json = true;
          config.check = true;
          config.color = false;
          config.historyEnabled = false;
          break;
        case "--project":
          config.projectPath = readValue();
          config.check = true;
          break;
        case "--include-dev":
          config.includeDev = true;
          break;
        case "--transitive":
          config.transitive = true;
          config.transitiveExplicit = true;
          break;
        case "--direct-only":
          config.transitive = false;
          config.transitiveExplicit = true;
          break;
        case "--write":
          config.write = true;
          break;
        case "--pin":
          config.pin = true;
          break;
        case "--all":
          config.all = true;
          break;
        case "--max-packages":
          config.projectMaxPackages = boundedIntegerFlag(parsed.name, readValue(), 1, 5_000);
          break;
        case "--ci":
          config.ci = true;
          config.check = true;
          config.color = false;
          break;
        case "--concurrency":
          config.projectConcurrency = boundedIntegerFlag(parsed.name, readValue(), 1, 8);
          break;
        case "--ai-limit":
          config.projectAiLimit = boundedIntegerFlag(parsed.name, readValue(), 0, 100);
          break;
        case "--models":
          config.models = true;
          break;
        case "--yes":
        case "-y":
          config.yes = true;
          break;
        case "--force":
          config.force = true;
          break;
        case "--no-color":
          config.color = false;
          break;
        case "--allow-install-scripts":
          config.allowInstallScripts = true;
          break;
        case "--no-advisories":
          config.advisories = false;
          break;
        case "--no-history":
          config.historyEnabled = false;
          break;
        case "--history-file":
          config.historyFile = readValue();
          break;
        case "--ai":
          config.aiMode = readValue();
          config.aiModeExplicit = true;
          break;
        case "--provider":
          config.provider = readValue();
          break;
        case "--model":
          config.model = readValue();
          break;
        case "--api-key":
          config.apiKey = readValue();
          if (!config.aiModeExplicit) {
            config.aiMode = "online";
          }
          break;
        case "--api-url":
          config.apiUrl = readValue();
          break;
        case "--ollama-url":
          config.ollamaUrl = readValue();
          break;
        case "--ollama-model":
          config.ollamaModel = readValue();
          break;
        case "--registry":
          config.registry = readValue();
          break;
        case "--bin": {
          const bin = readValue().trim();
          if (!bin) {
            throw new Error("--bin must name a package executable.");
          }
          config.bin = bin;
          break;
        }
        case "--age-days":
          config.ageDays = numberFlag(parsed.name, readValue());
          break;
        case "--downloads":
          config.downloadsThreshold = numberFlag(parsed.name, readValue());
          break;
        case "--caution-score":
          config.cautionScore = numberFlag(parsed.name, readValue());
          break;
        case "--block-score":
          config.blockScore = numberFlag(parsed.name, readValue());
          break;
        case "--timeout-ms":
          config.timeoutMs = numberFlag(parsed.name, readValue());
          break;
        case "--ai-timeout-ms":
          config.aiTimeoutMs = numberFlag(parsed.name, readValue());
          break;
        case "--max-ai-chars":
          config.maxAiChars = numberFlag(parsed.name, readValue());
          break;
        default:
          throw new Error(`Unknown option: ${parsed.name}`);
      }
      continue;
    }

    if (!config.packageSpec) {
      config.packageSpec = token;
      const rest = argv.slice(index + 1);
      config.packageArgs = rest[0] === "--" ? rest.slice(1) : rest;
      break;
    }
  }

  if (config.command === "approve-scripts") {
    if (config.packageSpec) {
      throw new Error("approve-scripts reviews a project, not a single package spec.");
    }
    config.projectPath = config.projectPath ?? ".";
    config.check = true;
  }

  if (!config.help && !config.version && !config.models && !config.packageSpec && !config.projectPath) {
    throw new Error("Missing package spec or --project <path>. Try --help.");
  }

  for (const [flag, enabled] of [["--write", config.write], ["--pin", config.pin], ["--all", config.all]]) {
    if (enabled && config.command !== "approve-scripts") {
      throw new Error(`${flag} is only available for the approve-scripts command.`);
    }
  }

  if (config.projectPath && config.packageSpec) {
    throw new Error("Use either --project <path> or a package spec, not both.");
  }

  if (config.includeDev && !config.projectPath) {
    throw new Error("--include-dev requires --project <path>.");
  }

  if (config.transitiveExplicit && !config.projectPath) {
    throw new Error("--transitive requires --project <path>.");
  }

  if (config.ci && !config.projectPath && config.command !== "approve-scripts") {
    throw new Error("--ci requires --project <path>.");
  }

  if (config.ci && config.json) {
    throw new Error("Use either --ci or --json so machine-readable output remains valid.");
  }

  if (config.agent && (config.yes || config.force || config.allowInstallScripts)) {
    throw new Error("--agent is read-only and cannot be combined with --yes, --force, or --allow-install-scripts.");
  }

  for (const [flag, enabled] of [
    ["--yes", config.yes],
    ["--force", config.force],
    ["--allow-install-scripts", config.allowInstallScripts],
  ]) {
    if (enabled && config.command !== "run") {
      throw new Error(`${flag} only applies to "npx-vibe run", which is the only command that executes a package.`);
    }
  }

  if (config.packageArgs.length && config.command !== "run") {
    throw new Error('Package arguments after -- only apply to "npx-vibe run".');
  }

  if (config.agent && config.packageArgs.length) {
    throw new Error("--agent performs a read-only scan and does not accept package execution arguments.");
  }

  if (config.projectPath && config.bin) {
    throw new Error("--bin applies to executable package mode, not project scans.");
  }

  if (config.projectPath && config.allowInstallScripts) {
    throw new Error("Project scans never execute install scripts; remove --allow-install-scripts.");
  }

  if (!["auto", "off", "online", "ollama"].includes(config.aiMode)) {
    throw new Error("--ai must be one of: auto, off, online, ollama.");
  }

  return config;
}

async function confirmExecution(result, config) {
  const verdict = result.verdict.verdict;
  if (verdict === "proceed") {
    return true;
  }

  if (verdict === "block") {
    return Boolean(config.force);
  }

  if (config.force || config.yes) {
    return true;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Proceed despite Caution? [y/N] ");
    return /^y(?:es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export function executePackage(snapshot, manifest, packageArgs, config) {
  const spec = snapshot.spec;
  const binCommand = findBinCommand(manifest, spec, config.bin);
  const npmPackage = `${spec.name}@${snapshot.version}`;
  const npmArgs = ["exec", "--yes", "--package", npmPackage];

  if (config.allowInstallScripts) {
    npmArgs.push("--strict-allow-scripts=true", `--allow-scripts=${spec.name}`);
  } else {
    npmArgs.push("--ignore-scripts=true");
  }

  npmArgs.push("--", binCommand, ...packageArgs);

  const launch = resolveNpmLauncher(npmArgs, config);

  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        resolve(1);
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

// Node refuses to spawn a .cmd shim without a shell, so `npm.cmd` fails outright
// on Windows. Running npm's own JavaScript entry point with the current node
// binary sidesteps both the shim and the shell, which keeps arguments out of a
// command-line parser entirely.
export function resolveNpmLauncher(npmArgs, config = {}, env = process.env, platform = process.platform) {
  if (config.npmBin) {
    return { command: config.npmBin, args: npmArgs, via: "configured" };
  }

  const execPath = env.npm_execpath;
  if (execPath && execPath.toLowerCase().endsWith(".js")) {
    return { command: process.execPath, args: [execPath, ...npmArgs], via: "npm_execpath" };
  }

  if (platform === "win32") {
    const cli = findWindowsNpmCli(env);
    if (cli) {
      return { command: process.execPath, args: [cli, ...npmArgs], via: "resolved-cli" };
    }
    throw new Error(
      "Could not locate npm's JavaScript entry point to run this package. " +
        "Set NPX_VIBE_NPM_BIN to an npm executable, or run npx-vibe through npx so npm_execpath is set."
    );
  }

  return { command: "npm", args: npmArgs, via: "path" };
}

function findWindowsNpmCli(env) {
  const roots = [];
  if (env.APPDATA) {
    roots.push(join(env.APPDATA, "npm", "node_modules", "npm"));
  }
  roots.push(join(dirname(process.execPath), "node_modules", "npm"));

  for (const root of roots) {
    for (const relative of [["bin", "npm-cli.js"], ["lib", "cli.js"]]) {
      const candidate = join(root, ...relative);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function safeFindBinCommand(manifest, spec, preferredBin) {
  try {
    return { command: findBinCommand(manifest, spec, preferredBin), error: null };
  } catch (error) {
    return { command: null, error: error.message };
  }
}

export function findBinCommand(manifest, spec, preferredBin) {
  const bin = manifest?.bin;
  if (typeof bin === "string") {
    const command = spec.unscopedName;
    if (preferredBin && preferredBin !== command) {
      throw new Error(`${spec.name} exposes the executable ${command}, not ${preferredBin}.`);
    }
    return command;
  }

  if (bin && typeof bin === "object" && !Array.isArray(bin)) {
    const names = Object.keys(bin);
    if (preferredBin) {
      if (Object.hasOwn(bin, preferredBin)) {
        return preferredBin;
      }
      throw new Error(`${spec.name} does not expose ${preferredBin}. Available binaries: ${names.join(", ")}.`);
    }
    if (names.includes(spec.unscopedName)) {
      return spec.unscopedName;
    }
    if (names.includes(spec.name)) {
      return spec.name;
    }
    if (names.length === 1) {
      return names[0];
    }
    throw new Error(`Package declares multiple binaries (${names.join(", ")}). Use --bin <name> to select one.`);
  }

  throw new Error(`${spec.name}@${manifest?.version ?? "unknown"} does not declare a binary entrypoint.`);
}

function sanitizeAiReview(aiReview) {
  return {
    status: aiReview.status,
    provider: aiReview.provider,
    providerLabel: aiReview.providerLabel,
    model: aiReview.model,
    modelSource: aiReview.modelSource,
    reason: aiReview.reason,
    riskScore: aiReview.riskScore,
    confidence: aiReview.confidence,
    recommendedVerdict: aiReview.recommendedVerdict,
    summary: aiReview.summary,
    findings: aiReview.findings ?? [],
    evidenceCoverage: aiReview.evidenceCoverage,
    evidenceSufficientForBlock: aiReview.evidenceSufficientForBlock,
    unsupportedFindingCount: aiReview.unsupportedFindingCount,
  };
}

function splitOption(token) {
  const equals = token.indexOf("=");
  if (equals === -1) {
    return { name: token, value: undefined };
  }
  return {
    name: token.slice(0, equals),
    value: token.slice(equals + 1),
  };
}

function numberFromEnv(value, fallback) {
  if (value === undefined || value === "") {
    return fallback;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function numberFlag(name, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${name} must be a number.`);
  }
  return number;
}

function argvRequestsAgent(argv) {
  const optionsWithValues = new Set([
    "--project", "--concurrency", "--ai-limit", "--ai", "--provider", "--model",
    "--model-profile", "--api-key", "--api-url", "--ollama-url", "--ollama-model",
    "--registry", "--bin", "--age-days", "--downloads", "--caution-score",
    "--block-score", "--timeout-ms", "--ai-timeout-ms", "--max-ai-chars", "--history-file",
    "--max-packages",
  ]);

  const tokens = SUBCOMMANDS.has(argv[0]) ? argv.slice(1) : argv;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--") {
      return false;
    }
    if (token === "--agent") {
      return true;
    }
    if (optionsWithValues.has(token)) {
      index += 1;
      continue;
    }
    if (!token.startsWith("-")) {
      return false;
    }
  }
  return false;
}

function boundedIntegerFromEnv(value, fallback, minimum, maximum) {
  if (value === undefined || value === "") {
    return fallback;
  }
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function boundedIntegerFlag(name, value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return number;
}

export { packageVersion };

function helpText() {
  return `npx-vibe - cautious npm exec wrapper

Usage:
  npx-vibe [options] <package-spec> [-- package args]
  npx-vibe --project <directory|package.json> [options]
  npx-vibe approve-scripts [--project <path>] [--write]

Examples:
  npx-vibe cowsay -- hello
  npx-vibe --check obscure-package
  npx-vibe --json obscure-package
  npx-vibe --agent obscure-package
  npx-vibe --bin tsc typescript -- --version
  npx-vibe --project .
  npx-vibe --project . --include-dev --json
  npx-vibe --project . --transitive
  npx-vibe approve-scripts
  npx-vibe approve-scripts --write
  npx-vibe approve-scripts --ci
  npx-vibe --agent --project .
  npx-vibe --mcp
  npx-vibe --project . --ci
  npx-vibe --models
  npx-vibe --provider gemini --api-key ... obscure-package
  OPENAI_API_KEY=... npx-vibe --ai online obscure-package
  ANTHROPIC_API_KEY=... npx-vibe --ai online obscure-package
  npx-vibe --ai online --provider gemini --model <id> --api-key ... obscure-package
  npx-vibe --ai online --provider custom --api-url https://models.example/v1/chat/completions --model my-model --api-key ... obscure-package
  npx-vibe --ai ollama --ollama-model qwen2.5-coder obscure-package

Commands:
  approve-scripts            Review every dependency npm would let run an install
                             script, and recommend approve, review, or deny with
                             source evidence. Reads package-lock.json, so it works
                             on npm 10 and 11 before you migrate to npm 12.
    --write                  Record the unambiguous decisions in package.json
                             allowScripts. Packages needing review are never
                             written; a person decides those.
    --pin                    Write name@version keys instead of bare names
    --all                    Re-review packages already in allowScripts

Options:
  --check                    Review only; do not execute
  --json                     Print JSON result; implies --check
  --agent                    Versioned, read-only JSON for coding agents; disables review-memory writes
  --mcp                      Start the read-only MCP server over stdio
  --project <path>           Scan direct registry dependencies without executing them
  --include-dev              Include devDependencies in a project scan
  --transitive               Scan the whole installed tree from package-lock.json
  --max-packages <1-5000>    Cap packages scanned in a project; default 500
  --ci                       Emit GitHub Actions annotations and a job summary
  --concurrency <1-8>        Heuristic project-scan concurrency; default 3
  --ai-limit <0-100>         Maximum triggered AI reviews per project scan; default 3
  --models                   Show supported AI providers and where to find their
                             current model lists
  --yes, -y                  Execute Caution verdicts without prompting
  --force                    Execute even when verdict is Block
  --ai off|auto|online|ollama  Default: off (heuristic-only)
  --provider auto|openai|anthropic|gemini|openrouter|groq|together|custom
  --model <name>             Required for online AI review
  --api-url <url>            OpenAI-compatible chat completions endpoint
  --api-key <key>            API key; also enables online mode (provider recommended)
  --ollama-url <url>         Default: http://127.0.0.1:11434
  --ollama-model <name>      Default: qwen2.5-coder
  --registry <url>           Default: https://registry.npmjs.org
  --bin <name>               Select an executable when a package exposes multiple binaries
  --age-days <days>          Young package threshold; default 14
  --downloads <count>        Low weekly downloads threshold; default 1000
  --caution-score <0-100>    Default 40
  --block-score <0-100>      Default 70
  --allow-install-scripts    Let npm run reviewed root install scripts where npm supports allow-scripts
  --no-advisories            Skip the OSV known-vulnerability lookup
  --no-history               Do not read or update local review memory
  --history-file <path>      Override the local review-memory file
  --no-color
  --help, -h
  --version, -v

Auto-detected keys (only after --ai online/auto opt-in):
  OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY,
  OPENROUTER_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, NPX_VIBE_API_KEY

Model selection:
  npx-vibe ships no model catalog, so --model (or NPX_VIBE_MODEL) is required
  for online review. A pinned id that a provider later retires would fail the
  call and report a false Caution rather than a clear error. Run --models for
  each provider's current model list.

Provider routing:
  Provider-specific environment variables are preferred. Recognizable key
  formats can be auto-detected; ambiguous keys require --provider and are
  never forwarded to a guessed service.

Dashboard details:
  Shows npm updated date, version publish date, license, maintainers,
  repository activity, registry trust context, matched source evidence,
  and integrity-keyed comparison with earlier local reviews.

Privacy:
  Online AI review sends only selected package metadata/files from the npm tarball.
  Local project files, environment variables, npm tokens, and shell history are not sent.
  Project mode reads package.json and package-lock.json locally; neither file is sent to AI.
  Prefer provider-specific environment variables so API keys do not enter shell history.
`;
}

function mcpHelpText() {
  return `npx-vibe MCP server

Start over stdio:
  npx-vibe --mcp
  npx-vibe-mcp

Tools:
  scan_package   Verify and inspect one public npm package
  scan_project   Scan direct registry dependencies from a project
  list_models    Return bundled provider model recommendations

The server writes newline-delimited JSON-RPC to stdout. Package code is never
executed, scan tools are read-only, AI is off unless a tool call explicitly
enables it, and provider credentials are read only from environment variables.
`;
}
