import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import {
  MCP_PROTOCOL_VERSION,
  NpxVibeMcpServer,
  startMcpServer,
} from "../src/mcp.js";

test("MCP registry metadata matches the npm release", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const serverJson = JSON.parse(await readFile(new URL("../server.json", import.meta.url), "utf8"));
  const npmPackage = serverJson.packages.find((entry) => entry.registryType === "npm");

  assert.equal(packageJson.version, "1.5.1");
  assert.equal(packageJson.mcpName, "io.github.Devrajsinh-Jhala/npx-vibe");
  assert.equal(packageJson.mcpName, serverJson.name);
  assert.equal(serverJson.version, packageJson.version);
  assert.equal(npmPackage.identifier, packageJson.name);
  assert.equal(npmPackage.version, packageJson.version);
  assert.deepEqual(npmPackage.packageArguments, [{ type: "positional", value: "--mcp" }]);
  assert.equal(npmPackage.transport.type, "stdio");
});

test("MCP initialize negotiates the stable protocol and advertises tools", async () => {
  const server = new NpxVibeMcpServer({ version: "1.5.0" });
  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  });

  assert.equal(response.result.protocolVersion, "2025-11-25");
  assert.equal(response.result.serverInfo.name, "npx-vibe");
  assert.equal(response.result.serverInfo.version, "1.5.0");
  assert.deepEqual(response.result.capabilities, { tools: { listChanged: false } });
  assert.match(response.result.instructions, /Caution requires human review/);

  const invalid = await server.handleMessage({
    jsonrpc: "2.0",
    id: 9,
    method: "initialize",
    params: { protocolVersion: MCP_PROTOCOL_VERSION },
  });
  assert.equal(invalid.error.code, -32602);
});

test("MCP tools are discoverable, read-only, and schema-backed", async () => {
  const server = new NpxVibeMcpServer({ version: "1.5.0" });
  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });

  assert.deepEqual(response.result.tools.map((tool) => tool.name), [
    "scan_package",
    "scan_project",
    "list_models",
  ]);
  for (const tool of response.result.tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.execution.taskSupport, "forbidden");
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.outputSchema.type, "object");
  }
  const scanPackage = response.result.tools.find((tool) => tool.name === "scan_package");
  assert.equal(Object.hasOwn(scanPackage.inputSchema.properties, "apiKey"), false);
});

test("MCP scan_package returns the agent decision as text and structured content", async () => {
  let receivedConfig;
  const server = new NpxVibeMcpServer({
    version: "1.5.0",
    cwd: "C:/workspace",
    reviewPackage: async (packageSpec, config) => {
      receivedConfig = config;
      assert.equal(packageSpec, "esbuild");
      return { result: packageResult("caution", 43) };
    },
  });

  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "scan_package", arguments: { package: "esbuild" } },
  });

  assert.equal(receivedConfig.agent, true);
  assert.equal(receivedConfig.check, true);
  assert.equal(receivedConfig.historyEnabled, false);
  assert.equal(receivedConfig.aiMode, "off");
  assert.equal(receivedConfig.cwd, "C:/workspace");
  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.kind, "package-scan");
  assert.equal(response.result.structuredContent.decision.action, "review");
  assert.deepEqual(JSON.parse(response.result.content[0].text), response.result.structuredContent);
});

test("MCP scan_project preserves project options and fail-closed decisions", async () => {
  let received;
  const server = new NpxVibeMcpServer({
    version: "1.5.0",
    scanProject: async (path, config, reviewer) => {
      received = { path, config, reviewer };
      return {
        kind: "project",
        project: { name: "demo", version: "1.0.0", manifestPath: "C:/demo/package.json" },
        verdict: { verdict: "block", score: 88 },
        summary: { discovered: 1, scanned: 1, skipped: 0, errors: 0, proceed: 0, caution: 0, block: 1 },
        ai: { enabled: false, limit: 0, attempted: 0, suppressed: 0 },
        packages: [packageResult("block", 88)],
        skipped: [],
        errors: [],
      };
    },
  });

  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "scan_project",
      arguments: { path: "C:/demo", includeDev: true, concurrency: 4, aiLimit: 1 },
    },
  });

  assert.equal(received.path, "C:/demo");
  assert.equal(received.config.includeDev, true);
  assert.equal(received.config.projectConcurrency, 4);
  assert.equal(received.config.projectAiLimit, 1);
  assert.equal(typeof received.reviewer, "function");
  assert.equal(response.result.structuredContent.kind, "project-scan");
  assert.equal(response.result.structuredContent.decision.action, "stop");
  assert.equal(response.result.structuredContent.decision.exitCode, 3);
  assert.equal(response.result.isError, false);
});

test("MCP scan failures are tool errors with fail-closed structured output", async () => {
  const server = new NpxVibeMcpServer({
    version: "1.5.0",
    reviewPackage: async () => {
      throw new Error("registry unavailable");
    },
  });
  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "scan_package", arguments: { package: "demo" } },
  });

  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.kind, "error");
  assert.equal(response.result.structuredContent.decision.mustStop, true);
  assert.equal(response.result.structuredContent.error.code, "package_scan_failed");
});

test("MCP rejects unknown tools and invalid arguments at the protocol layer", async () => {
  const server = new NpxVibeMcpServer({ version: "1.5.0" });
  const unknown = await server.handleMessage({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "execute_package", arguments: {} },
  });
  const invalid = await server.handleMessage({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name: "scan_package", arguments: { package: "demo", apiKey: "secret" } },
  });

  assert.equal(unknown.error.code, -32602);
  assert.equal(invalid.error.code, -32602);
  assert.match(invalid.error.message, /Unknown tool argument: apiKey/);
});

test("MCP stdio transport emits one compact JSON-RPC message per line", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  output.setEncoding("utf8");
  let text = "";
  output.on("data", (chunk) => {
    text += chunk;
  });
  const server = new NpxVibeMcpServer({ version: "1.5.0" });
  const running = startMcpServer({ input, output, server });

  input.end(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 8,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "stdio-test", version: "1.0.0" },
    },
  })}\n${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  await running;

  const lines = text.trim().split("\n");
  assert.equal(lines.length, 1);
  const response = JSON.parse(lines[0]);
  assert.equal(response.id, 8);
  assert.equal(response.result.protocolVersion, "2025-06-18");
});

function packageResult(verdict, score) {
  return {
    package: { name: "esbuild", requested: "latest", version: "0.28.1" },
    profile: {},
    verdict: { verdict, score },
    stats: {},
    findings: [],
    ai: { status: "skipped", reason: "AI was not requested." },
    history: { status: "disabled" },
    execution: { npmPackage: "esbuild@0.28.1", bin: "esbuild", installScripts: "ignored", binError: null },
  };
}
