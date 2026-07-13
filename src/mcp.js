import { createAgentError, createAgentResult } from "./output.js";
import { parseArgs, packageVersion, reviewPackage } from "./cli.js";
import { projectExitCode, scanProject } from "./project.js";
import { providerModelCatalog, modelProfiles } from "./providers.js";
import { checkExitCode } from "./verdict.js";

export const MCP_PROTOCOL_VERSION = "2025-11-25";
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  MCP_PROTOCOL_VERSION,
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;
const JSON_SCHEMA = "https://json-schema.org/draft/2020-12/schema";
const AI_MODES = ["off", "auto", "online", "ollama"];
const PROVIDERS = ["auto", "openai", "anthropic", "gemini", "openrouter", "groq", "together", "custom"];
const MODEL_PROFILES = ["fast", "balanced", "strong"];

const COMMON_AI_PROPERTIES = {
  ai: {
    type: "string",
    enum: AI_MODES,
    default: "off",
    description: "Optional AI review mode. Heuristic-only scanning is the default.",
  },
  provider: {
    type: "string",
    enum: PROVIDERS,
    default: "auto",
    description: "AI provider. Credentials are read from environment variables, never tool arguments.",
  },
  modelProfile: {
    type: "string",
    enum: MODEL_PROFILES,
    default: "balanced",
    description: "Maintained quality, latency, and cost profile.",
  },
  model: {
    type: "string",
    minLength: 1,
    description: "Optional exact provider model identifier.",
  },
};

const AGENT_OUTPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    tool: {
      type: "object",
      properties: {
        name: { type: "string" },
        version: { type: "string" },
      },
      required: ["name", "version"],
    },
    kind: { type: "string", enum: ["package-scan", "project-scan", "error"] },
    status: { type: "string", enum: ["complete", "incomplete", "error"] },
    decision: {
      type: "object",
      properties: {
        verdict: { type: ["string", "null"] },
        riskScore: { type: ["number", "null"] },
        action: { type: "string", enum: ["continue", "review", "stop", "retry"] },
        exitCode: { type: "integer" },
        mayContinue: { type: "boolean" },
        safeToExecute: { type: "boolean" },
        requiresApproval: { type: "boolean" },
        requiresHumanReview: { type: "boolean" },
        blocked: { type: "boolean" },
        mustStop: { type: "boolean" },
      },
      required: [
        "verdict",
        "riskScore",
        "action",
        "exitCode",
        "mayContinue",
        "safeToExecute",
        "requiresApproval",
        "requiresHumanReview",
        "blocked",
        "mustStop",
      ],
    },
    subject: { type: "object" },
    report: { type: "object" },
    error: { type: "object" },
  },
  required: ["schemaVersion", "tool", "kind", "status", "decision"],
};

const TOOL_DEFINITIONS = [
  {
    name: "scan_package",
    title: "Scan an npm package",
    description: "Resolve, verify, and inspect one public npm registry package without executing package code. Use before installing, recommending, or running an unfamiliar package. Obey decision.action: continue, review, stop, or retry.",
    inputSchema: {
      $schema: JSON_SCHEMA,
      type: "object",
      properties: {
        package: {
          type: "string",
          minLength: 1,
          description: "npm package spec such as esbuild, @scope/tool, or package@version.",
        },
        ...COMMON_AI_PROPERTIES,
      },
      required: ["package"],
      additionalProperties: false,
    },
    outputSchema: AGENT_OUTPUT_SCHEMA,
    annotations: readOnlyAnnotations("Scan npm package", true),
    execution: { taskSupport: "forbidden" },
  },
  {
    name: "scan_project",
    title: "Scan project dependencies",
    description: "Inspect direct public-registry dependencies from package.json and package-lock.json without installing or executing them. Use after dependency or lockfile changes and before installation.",
    inputSchema: {
      $schema: JSON_SCHEMA,
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
          default: ".",
          description: "Project directory or package.json path, relative to the MCP server working directory or absolute.",
        },
        includeDev: {
          type: "boolean",
          default: false,
          description: "Include direct devDependencies in addition to production and optional dependencies.",
        },
        concurrency: {
          type: "integer",
          minimum: 1,
          maximum: 8,
          default: 3,
          description: "Maximum concurrent heuristic package scans.",
        },
        aiLimit: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          default: 3,
          description: "Maximum triggered AI reviews when AI is explicitly enabled.",
        },
        ...COMMON_AI_PROPERTIES,
      },
      additionalProperties: false,
    },
    outputSchema: AGENT_OUTPUT_SCHEMA,
    annotations: readOnlyAnnotations("Scan project dependencies", true),
    execution: { taskSupport: "forbidden" },
  },
  {
    name: "list_models",
    title: "List recommended AI models",
    description: "Return the provider model recommendations bundled with this npx-vibe release. This does not access a model provider or require credentials.",
    inputSchema: {
      $schema: JSON_SCHEMA,
      type: "object",
      additionalProperties: false,
    },
    outputSchema: {
      $schema: JSON_SCHEMA,
      type: "object",
      properties: {
        schemaVersion: { type: "integer", const: 1 },
        tool: { type: "object" },
        defaultProfile: { type: "string" },
        profiles: { type: "array", items: { type: "string" } },
        providers: { type: "array", items: { type: "object" } },
      },
      required: ["schemaVersion", "tool", "defaultProfile", "profiles", "providers"],
    },
    annotations: readOnlyAnnotations("List npx-vibe models", false),
    execution: { taskSupport: "forbidden" },
  },
];

export class NpxVibeMcpServer {
  constructor(options = {}) {
    this.env = options.env ?? process.env;
    this.version = options.version ?? packageVersion();
    this.cwd = options.cwd ?? process.cwd();
    this.reviewPackageFn = options.reviewPackage ?? reviewPackage;
    this.scanProjectFn = options.scanProject ?? scanProject;
    this.initialized = false;
  }

  async handleMessage(message) {
    if (!isPlainObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return jsonRpcError(requestId(message), -32600, "Invalid JSON-RPC request.");
    }

    const isNotification = !Object.hasOwn(message, "id");
    if (isNotification) {
      this.handleNotification(message);
      return null;
    }
    if (message.id === null || (typeof message.id !== "string" && typeof message.id !== "number")) {
      return jsonRpcError(null, -32600, "Request id must be a string or number.");
    }

    try {
      switch (message.method) {
        case "initialize":
          return jsonRpcResult(message.id, this.initialize(message.params));
        case "ping":
          return jsonRpcResult(message.id, {});
        case "tools/list":
          return jsonRpcResult(message.id, { tools: TOOL_DEFINITIONS });
        case "tools/call":
          return jsonRpcResult(message.id, await this.callTool(message.params));
        default:
          return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
      }
    } catch (error) {
      if (error instanceof McpProtocolError) {
        return jsonRpcError(message.id, error.code, error.message, error.data);
      }
      return jsonRpcError(message.id, -32603, "Internal MCP server error.");
    }
  }

  initialize(params) {
    if (!isPlainObject(params) ||
        typeof params.protocolVersion !== "string" ||
        !isPlainObject(params.capabilities) ||
        !isPlainObject(params.clientInfo) ||
        typeof params.clientInfo.name !== "string" ||
        typeof params.clientInfo.version !== "string") {
      throw new McpProtocolError(-32602, "initialize requires protocolVersion, capabilities, and clientInfo.");
    }
    this.initialized = true;
    return {
      protocolVersion: negotiateProtocolVersion(params.protocolVersion),
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: {
        name: "npx-vibe",
        version: this.version,
        description: "Read-only npm package and project dependency preflight tools.",
      },
      instructions: "Use scan_package before unfamiliar npm install or execution actions and scan_project after dependency changes. Continue only when decision.action is continue. Caution requires human review; Block and incomplete scans must stop.",
    };
  }

  handleNotification(message) {
    if (message.method === "notifications/initialized") {
      this.initialized = true;
    }
  }

  async callTool(params) {
    if (!isPlainObject(params) || typeof params.name !== "string") {
      throw new McpProtocolError(-32602, "tools/call requires a tool name and arguments object.");
    }
    const args = params.arguments === undefined ? {} : params.arguments;
    if (!isPlainObject(args)) {
      throw new McpProtocolError(-32602, "Tool arguments must be a JSON object.");
    }

    switch (params.name) {
      case "scan_package":
        return this.scanPackageTool(args);
      case "scan_project":
        return this.scanProjectTool(args);
      case "list_models":
        validateArguments(args, new Set(), {});
        return toolResult(this.modelCatalog());
      default:
        throw new McpProtocolError(-32602, `Unknown tool: ${params.name}`);
    }
  }

  async scanPackageTool(args) {
    validateArguments(args, new Set(["package", "ai", "provider", "modelProfile", "model"]), {
      requiredStrings: ["package"],
    });
    const config = createScanConfig(args, "package", this.env, this.cwd);

    try {
      const { result } = await this.reviewPackageFn(config.packageSpec, config);
      const exitCode = checkExitCode(result.verdict.verdict);
      return toolResult(createAgentResult(result, {
        kind: "package-scan",
        exitCode,
        version: this.version,
      }));
    } catch (error) {
      return toolResult(createAgentError(error, {
        code: "package_scan_failed",
        version: this.version,
      }), true);
    }
  }

  async scanProjectTool(args) {
    validateArguments(args, new Set([
      "path", "includeDev", "concurrency", "aiLimit", "ai", "provider", "modelProfile", "model",
    ]), {
      optionalStrings: ["path"],
      booleans: ["includeDev"],
      boundedIntegers: {
        concurrency: [1, 8],
        aiLimit: [0, 100],
      },
    });
    const config = createScanConfig(args, "project", this.env, this.cwd);

    try {
      const scan = await this.scanProjectFn(config.projectPath, config, this.reviewPackageFn);
      const exitCode = projectExitCode(scan);
      return toolResult(createAgentResult(scan, {
        kind: "project-scan",
        exitCode,
        version: this.version,
      }));
    } catch (error) {
      return toolResult(createAgentError(error, {
        code: "project_scan_failed",
        version: this.version,
      }), true);
    }
  }

  modelCatalog() {
    return {
      schemaVersion: 1,
      tool: { name: "npx-vibe", version: this.version },
      defaultProfile: "balanced",
      profiles: modelProfiles(),
      providers: providerModelCatalog(),
    };
  }
}

export async function startMcpServer(options = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const server = options.server ?? new NpxVibeMcpServer(options);
  let buffer = "";

  input.setEncoding?.("utf8");
  for await (const chunk of input) {
    buffer += String(chunk);
    if (Buffer.byteLength(buffer, "utf8") > MAX_MESSAGE_BYTES) {
      output.write(`${JSON.stringify(jsonRpcError(null, -32700, "MCP message exceeded the 10 MB limit."))}\n`);
      buffer = "";
      continue;
    }

    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      await handleLine(server, line, output);
    }
  }

  if (buffer.trim()) {
    await handleLine(server, buffer.replace(/\r$/, ""), output);
  }
  return 0;
}

async function handleLine(server, line, output) {
  if (!line.trim()) {
    return;
  }
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    output.write(`${JSON.stringify(jsonRpcError(null, -32700, "Invalid JSON."))}\n`);
    return;
  }
  const response = await server.handleMessage(message);
  if (response) {
    output.write(`${JSON.stringify(response)}\n`);
  }
}

function createScanConfig(args, kind, env, cwd) {
  const argv = ["--agent", "--ai", args.ai ?? "off"];
  if (args.provider !== undefined) argv.push("--provider", args.provider);
  if (args.modelProfile !== undefined) argv.push("--model-profile", args.modelProfile);
  if (args.model !== undefined) argv.push("--model", args.model);

  if (kind === "project") {
    argv.push("--project", args.path ?? ".");
    if (args.includeDev) argv.push("--include-dev");
    if (args.concurrency !== undefined) argv.push("--concurrency", String(args.concurrency));
    if (args.aiLimit !== undefined) argv.push("--ai-limit", String(args.aiLimit));
  } else {
    argv.push(args.package);
  }

  const config = parseArgs(argv, env);
  config.cwd = cwd;
  return config;
}

function validateArguments(args, allowed, options) {
  for (const name of Object.keys(args)) {
    if (!allowed.has(name)) {
      throw new McpProtocolError(-32602, `Unknown tool argument: ${name}`);
    }
  }
  for (const name of options.requiredStrings ?? []) {
    if (typeof args[name] !== "string" || !args[name].trim()) {
      throw new McpProtocolError(-32602, `${name} must be a non-empty string.`);
    }
  }
  for (const name of options.optionalStrings ?? []) {
    if (args[name] !== undefined && (typeof args[name] !== "string" || !args[name].trim())) {
      throw new McpProtocolError(-32602, `${name} must be a non-empty string when provided.`);
    }
  }
  for (const name of options.booleans ?? []) {
    if (args[name] !== undefined && typeof args[name] !== "boolean") {
      throw new McpProtocolError(-32602, `${name} must be a boolean.`);
    }
  }
  for (const [name, [minimum, maximum]] of Object.entries(options.boundedIntegers ?? {})) {
    if (args[name] !== undefined && (!Number.isInteger(args[name]) || args[name] < minimum || args[name] > maximum)) {
      throw new McpProtocolError(-32602, `${name} must be an integer from ${minimum} to ${maximum}.`);
    }
  }
  validateEnum(args, "ai", AI_MODES);
  validateEnum(args, "provider", PROVIDERS);
  validateEnum(args, "modelProfile", MODEL_PROFILES);
  if (args.model !== undefined && (typeof args.model !== "string" || !args.model.trim())) {
    throw new McpProtocolError(-32602, "model must be a non-empty string when provided.");
  }
}

function validateEnum(args, name, values) {
  if (args[name] !== undefined && !values.includes(args[name])) {
    throw new McpProtocolError(-32602, `${name} must be one of: ${values.join(", ")}.`);
  }
}

function toolResult(payload, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError,
  };
}

function readOnlyAnnotations(title, openWorldHint) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint,
  };
}

function negotiateProtocolVersion(requested) {
  return MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSION;
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    ...(id !== undefined ? { id } : {}),
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  };
}

function requestId(message) {
  return isPlainObject(message) && Object.hasOwn(message, "id") ? message.id : undefined;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

class McpProtocolError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}
