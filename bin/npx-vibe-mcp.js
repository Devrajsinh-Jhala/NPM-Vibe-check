#!/usr/bin/env node
import { startMcpServer } from "../src/mcp.js";

try {
  await startMcpServer();
} catch (error) {
  console.error(`npx-vibe MCP: ${error.message}`);
  process.exitCode = 1;
}
