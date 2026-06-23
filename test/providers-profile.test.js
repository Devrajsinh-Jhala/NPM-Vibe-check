import test from "node:test";
import assert from "node:assert/strict";
import { resolveOnlineProvider } from "../src/providers.js";
import { normalizeRepository } from "../src/profile.js";

test("resolveOnlineProvider auto-detects provider-specific env keys", () => {
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKeys: { ANTHROPIC_API_KEY: "sk-ant-demo" } }).name, "anthropic");
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKeys: { GEMINI_API_KEY: "AIza-demo" } }).name, "gemini");
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKeys: { GROQ_API_KEY: "gsk_demo" } }).name, "groq");
});

test("resolveOnlineProvider infers provider from direct api key when possible", () => {
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKey: "sk-ant-demo" }).name, "anthropic");
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKey: "AIza-demo" }).name, "gemini");
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKey: "unknown" }).name, "openai-compatible");
});

test("resolveOnlineProvider supports explicit custom OpenAI-compatible endpoint", () => {
  const provider = resolveOnlineProvider({
    provider: "custom",
    apiKey: "test-key",
    apiUrl: "https://models.example.test/v1/chat/completions",
    model: "local-model",
  });
  assert.equal(provider.name, "openai-compatible");
  assert.equal(provider.url, "https://models.example.test/v1/chat/completions");
  assert.equal(provider.model, "local-model");
});

test("normalizeRepository extracts GitHub slugs from common npm repository values", () => {
  assert.equal(normalizeRepository({ type: "git", url: "git+https://github.com/owner/repo.git" }).github, "owner/repo");
  assert.equal(normalizeRepository("github:owner/repo").github, "owner/repo");
  assert.equal(normalizeRepository("git@github.com:owner/repo.git").display, "github.com/owner/repo");
});