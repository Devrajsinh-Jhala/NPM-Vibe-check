import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { parsePackageSpec } from "./spec.js";
import { loadPackageSnapshot, downloadTarball, verifyTarball } from "./registry.js";
import { inspectTarball } from "./tarball.js";
import { analyzePackage, addAiUnavailableFinding } from "./analysis.js";
import { maybeRunAiReview } from "./ai.js";
import { decideVerdict, checkExitCode } from "./verdict.js";
import { renderDashboard, toJsonResult } from "./output.js";

export async function main(argv = process.argv.slice(2)) {
  try {
    const exitCode = await run(argv);
    process.exitCode = exitCode;
  } catch (error) {
    console.error(`npx-vibe: ${error.message}`);
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

  const { result, manifest, snapshot } = await reviewPackage(config.packageSpec, config);

  if (config.json) {
    console.log(toJsonResult(result));
    return checkExitCode(result.verdict.verdict);
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

export async function reviewPackage(packageSpecInput, config) {
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
  const aiReview = await maybeRunAiReview(snapshot, analysis, tarballInspection, config);

  if (analysis.needsAi && aiReview.status === "unavailable") {
    analysis = addAiUnavailableFinding(analysis, aiReview.reason ?? "unknown reason");
  }

  const verdict = decideVerdict(analysis, aiReview, config);
  const binInfo = safeFindBinCommand(analysis.manifest, spec);

  return {
    snapshot,
    manifest: analysis.manifest,
    result: {
      package: {
        name: spec.name,
        requested: spec.wanted,
        version: snapshot.version,
        tarball: snapshot.tarball,
        integrity: {
          checked: integrity.checked,
          ok: integrity.ok,
        },
        bin: binInfo.command,
      },
      profile: snapshot.profile,
      verdict,
      stats: analysis.stats,
      findings: analysis.findings,
      ai: sanitizeAiReview(aiReview),
      execution: {
        npmPackage: `${spec.name}@${snapshot.version}`,
        bin: binInfo.command,
        installScripts: config.allowInstallScripts ? "allow-reviewed-root" : "ignored",
        binError: binInfo.error,
      },
    },
  };
}

export function parseArgs(argv, env = process.env) {
  const config = {
    aiMode: env.NPX_VIBE_AI ?? "auto",
    apiKey: env.NPX_VIBE_API_KEY,
    apiUrl: env.NPX_VIBE_API_URL,
    provider: env.NPX_VIBE_PROVIDER ?? env.NPX_VIBE_AI_PROVIDER ?? "auto",
    model: env.NPX_VIBE_MODEL,
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
    npmBin: env.NPX_VIBE_NPM_BIN,
    check: false,
    json: false,
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
        case "--ai":
          config.aiMode = readValue();
          break;
        case "--provider":
          config.provider = readValue();
          break;
        case "--model":
          config.model = readValue();
          break;
        case "--api-key":
          config.apiKey = readValue();
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

  if (!config.help && !config.version && !config.packageSpec) {
    throw new Error("Missing package spec. Try --help.");
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
  const binCommand = findBinCommand(manifest, spec);
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

function safeFindBinCommand(manifest, spec) {
  try {
    return { command: findBinCommand(manifest, spec), error: null };
  } catch (error) {
    return { command: null, error: error.message };
  }
}

export function findBinCommand(manifest, spec) {
  const bin = manifest?.bin;
  if (typeof bin === "string") {
    return spec.unscopedName;
  }

  if (bin && typeof bin === "object" && !Array.isArray(bin)) {
    const names = Object.keys(bin);
    if (names.includes(spec.unscopedName)) {
      return spec.unscopedName;
    }
    if (names.includes(spec.name)) {
      return spec.name;
    }
    if (names.length === 1) {
      return names[0];
    }
    throw new Error(`Package declares multiple binaries (${names.join(", ")}). Pass the desired binary after npm installs are supported in a future version.`);
  }

  throw new Error(`${spec.name}@${manifest?.version ?? "unknown"} does not declare a binary entrypoint.`);
}

function sanitizeAiReview(aiReview) {
  return {
    status: aiReview.status,
    provider: aiReview.provider,
    providerLabel: aiReview.providerLabel,
    model: aiReview.model,
    reason: aiReview.reason,
    riskScore: aiReview.riskScore,
    confidence: aiReview.confidence,
    recommendedVerdict: aiReview.recommendedVerdict,
    summary: aiReview.summary,
    findings: aiReview.findings ?? [],
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

function packageVersion() {
  const here = dirname(fileURLToPath(import.meta.url));
  const packageJson = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
  return packageJson.version;
}

function helpText() {
  return `npx-vibe - cautious npm exec wrapper

Usage:
  npx-vibe [options] <package-spec> [-- package args]

Examples:
  npx-vibe cowsay -- hello
  npx-vibe --check obscure-package
  npx-vibe --json --ai off obscure-package
  OPENAI_API_KEY=... npx-vibe --ai online obscure-package
  ANTHROPIC_API_KEY=... npx-vibe --ai online obscure-package
  npx-vibe --ai online --provider gemini --api-key AIza... obscure-package
  npx-vibe --ai online --provider custom --api-url https://models.example/v1/chat/completions --api-key ... obscure-package
  npx-vibe --ai ollama --ollama-model qwen2.5-coder obscure-package

Options:
  --check                    Review only; do not execute
  --json                     Print JSON result; implies --check
  --yes, -y                  Execute Caution verdicts without prompting
  --force                    Execute even when verdict is Block
  --ai auto|off|online|ollama
  --provider auto|openai|anthropic|gemini|openrouter|groq|together|custom
  --model <name>             Online model name
  --api-url <url>            OpenAI-compatible chat completions endpoint
  --api-key <key>            API key for online mode
  --ollama-url <url>         Default: http://127.0.0.1:11434
  --ollama-model <name>      Default: qwen2.5-coder
  --registry <url>           Default: https://registry.npmjs.org
  --age-days <days>          Young package threshold; default 14
  --downloads <count>        Low weekly downloads threshold; default 1000
  --caution-score <0-100>    Default 40
  --block-score <0-100>      Default 70
  --allow-install-scripts    Let npm run reviewed root install scripts where npm supports allow-scripts
  --no-color
  --help, -h
  --version, -v

Auto-detected keys:
  OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY,
  OPENROUTER_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, NPX_VIBE_API_KEY

Dashboard details:
  Shows npm updated date, version publish date, license, maintainers,
  repository, GitHub stars, last push, and latest commit when available.

Privacy:
  Online AI review sends only selected package metadata/files from the npm tarball.
  Local project files, environment variables, npm tokens, and shell history are not sent.
`;
}