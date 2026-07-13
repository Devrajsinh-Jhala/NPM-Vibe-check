import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
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
  toAgentError,
  toAgentResult,
  toJsonResult,
} from "./output.js";
import { formatProviderModelCatalog, modelProfiles } from "./providers.js";
import { projectExitCode, scanProject } from "./project.js";
import {
  compareReviewMemory,
  createReviewFingerprint,
  loadReviewMemory,
  saveReviewMemory,
} from "./history.js";

export async function main(argv = process.argv.slice(2)) {
  try {
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

  if (config.help) {
    console.log(helpText());
    return 0;
  }

  if (config.version) {
    console.log(packageVersion());
    return 0;
  }

  if (config.models) {
    console.log(formatProviderModelCatalog());
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

  if (config.check) {
    return checkExitCode(result.verdict.verdict);
  }

  const permitted = await confirmExecution(result, config);
  if (!permitted) {
    return checkExitCode(result.verdict.verdict);
  }

  return executePackage(snapshot, manifest, config.packageArgs, config);
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

export function parseArgs(argv, env = process.env) {
  const aiModeExplicit = Boolean(env.NPX_VIBE_AI);
  const config = {
    aiMode: env.NPX_VIBE_AI ?? (env.NPX_VIBE_API_KEY ? "online" : "off"),
    aiModeExplicit,
    apiKey: env.NPX_VIBE_API_KEY,
    apiUrl: env.NPX_VIBE_API_URL,
    provider: env.NPX_VIBE_PROVIDER ?? env.NPX_VIBE_AI_PROVIDER ?? "auto",
    model: env.NPX_VIBE_MODEL,
    modelProfile: env.NPX_VIBE_MODEL_PROFILE ?? "balanced",
    appUrl: env.NPX_VIBE_APP_URL,
    aiMaxTokens: numberFromEnv(env.NPX_VIBE_AI_MAX_TOKENS, 1_500),
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
    ageDays: numberFromEnv(env.NPX_VIBE_AGE_DAYS, 14),
    downloadsThreshold: numberFromEnv(env.NPX_VIBE_DOWNLOADS, 1_000),
    cautionScore: numberFromEnv(env.NPX_VIBE_CAUTION_SCORE, 40),
    blockScore: numberFromEnv(env.NPX_VIBE_BLOCK_SCORE, 70),
    timeoutMs: numberFromEnv(env.NPX_VIBE_TIMEOUT_MS, 15_000),
    aiTimeoutMs: numberFromEnv(env.NPX_VIBE_AI_TIMEOUT_MS, 30_000),
    maxAiChars: numberFromEnv(env.NPX_VIBE_MAX_AI_CHARS, 120_000),
    historyEnabled: env.NPX_VIBE_HISTORY !== "off",
    historyFile: env.NPX_VIBE_HISTORY_FILE,
    npmBin: env.NPX_VIBE_NPM_BIN,
    bin: env.NPX_VIBE_BIN,
    projectPath: undefined,
    projectConcurrency: boundedIntegerFromEnv(env.NPX_VIBE_CONCURRENCY, 3, 1, 8),
    projectAiLimit: boundedIntegerFromEnv(env.NPX_VIBE_AI_LIMIT, 3, 0, 100),
    includeDev: false,
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
        case "--model-profile":
          config.modelProfile = readValue().toLowerCase();
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

  if (!config.help && !config.version && !config.models && !config.packageSpec && !config.projectPath) {
    throw new Error("Missing package spec or --project <path>. Try --help.");
  }

  if (config.projectPath && config.packageSpec) {
    throw new Error("Use either --project <path> or a package spec, not both.");
  }

  if (config.includeDev && !config.projectPath) {
    throw new Error("--include-dev requires --project <path>.");
  }

  if (config.ci && !config.projectPath) {
    throw new Error("--ci requires --project <path>.");
  }

  if (config.ci && config.json) {
    throw new Error("Use either --ci or --json so machine-readable output remains valid.");
  }

  if (config.agent && (config.yes || config.force || config.allowInstallScripts)) {
    throw new Error("--agent is read-only and cannot be combined with --yes, --force, or --allow-install-scripts.");
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

  if (!modelProfiles().includes(config.modelProfile)) {
    throw new Error("--model-profile must be one of: fast, balanced, strong.");
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
  const npmBin = config.npmBin ?? (process.platform === "win32" ? "npm.cmd" : "npm");
  const npmArgs = ["exec", "--yes", "--package", npmPackage];

  if (config.allowInstallScripts) {
    npmArgs.push("--strict-allow-scripts=true", `--allow-scripts=${spec.name}`);
  } else {
    npmArgs.push("--ignore-scripts=true");
  }

  npmArgs.push("--", binCommand, ...packageArgs);

  return new Promise((resolve, reject) => {
    const child = spawn(npmBin, npmArgs, {
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
    modelProfile: aiReview.modelProfile,
    modelSource: aiReview.modelSource,
    catalogVerifiedAt: aiReview.catalogVerifiedAt,
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
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
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

function packageVersion() {
  const here = dirname(fileURLToPath(import.meta.url));
  const packageJson = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
  return packageJson.version;
}

function helpText() {
  return `npx-vibe - cautious npm exec wrapper

Usage:
  npx-vibe [options] <package-spec> [-- package args]
  npx-vibe --project <directory|package.json> [options]

Examples:
  npx-vibe cowsay -- hello
  npx-vibe --check obscure-package
  npx-vibe --json obscure-package
  npx-vibe --agent obscure-package
  npx-vibe --bin tsc typescript -- --version
  npx-vibe --project .
  npx-vibe --project . --include-dev --json
  npx-vibe --agent --project .
  npx-vibe --project . --ci
  npx-vibe --models
  npx-vibe --provider gemini --api-key ... obscure-package
  OPENAI_API_KEY=... npx-vibe --ai online obscure-package
  ANTHROPIC_API_KEY=... npx-vibe --ai online obscure-package
  npx-vibe --ai online --provider gemini --model-profile strong --api-key ... obscure-package
  npx-vibe --ai online --provider custom --api-url https://models.example/v1/chat/completions --model my-model --api-key ... obscure-package
  npx-vibe --ai ollama --ollama-model qwen2.5-coder obscure-package

Options:
  --check                    Review only; do not execute
  --json                     Print JSON result; implies --check
  --agent                    Versioned, read-only JSON for coding agents; disables review-memory writes
  --project <path>           Scan direct registry dependencies without executing them
  --include-dev              Include devDependencies in a project scan
  --ci                       Emit GitHub Actions annotations and a job summary
  --concurrency <1-8>        Heuristic project-scan concurrency; default 3
  --ai-limit <0-100>         Maximum triggered AI reviews per project scan; default 3
  --models                   Show bundled provider model recommendations
  --yes, -y                  Execute Caution verdicts without prompting
  --force                    Execute even when verdict is Block
  --ai off|auto|online|ollama  Default: off (heuristic-only)
  --provider auto|openai|anthropic|gemini|openrouter|groq|together|custom
  --model-profile <profile>  fast, balanced (default), or strong
  --model <name>             Exact online model; overrides the profile
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
  --no-history               Do not read or update local review memory
  --history-file <path>      Override the local review-memory file
  --no-color
  --help, -h
  --version, -v

Auto-detected keys (only after --ai online/auto opt-in):
  OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY,
  OPENROUTER_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, NPX_VIBE_API_KEY

Model selection:
  The balanced profile chooses a current provider-specific model.
  Use --models to inspect the bundled mapping, --model-profile for a
  simple quality/cost choice, or --model for an exact provider model.

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
