import test from "node:test";
import assert from "node:assert/strict";
import { formatProviderModelCatalog, resolveOnlineProvider } from "../src/providers.js";
import { normalizeRepository } from "../src/profile.js";

test("resolveOnlineProvider auto-detects provider-specific env keys", () => {
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKeys: { ANTHROPIC_API_KEY: "sk-ant-demo" } }).name, "anthropic");
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKeys: { GEMINI_API_KEY: "AIza-demo" } }).name, "gemini");
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKeys: { GROQ_API_KEY: "gsk_demo" } }).name, "groq");
});

test("resolveOnlineProvider infers provider from direct api key when possible", () => {
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKey: "sk-ant-demo" }).name, "anthropic");
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKey: "AIza-demo" }).name, "gemini");
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKey: "unknown" }).name, "openai");
});

test("resolveOnlineProvider defaults to the balanced current model profile", () => {
  const gemini = resolveOnlineProvider({ provider: "gemini", apiKey: "AIza-demo" });
  const anthropic = resolveOnlineProvider({ provider: "anthropic", apiKey: "sk-ant-demo" });
  assert.equal(gemini.model, "gemini-3.5-flash");
  assert.equal(gemini.modelProfile, "balanced");
  assert.equal(anthropic.model, "claude-sonnet-4-6");
});

test("model profiles are selectable and an exact model wins", () => {
  assert.equal(resolveOnlineProvider({ provider: "openai", apiKey: "demo", modelProfile: "fast" }).model, "gpt-5.4-nano");
  const exact = resolveOnlineProvider({
    provider: "gemini",
    apiKey: "AIza-demo",
    modelProfile: "strong",
    model: "gemini-custom-preview",
  });
  assert.equal(exact.model, "gemini-custom-preview");
  assert.equal(exact.modelSource, "explicit");
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

test("custom OpenAI-compatible endpoints require an exact model", () => {
  assert.throws(() => resolveOnlineProvider({
    provider: "custom",
    apiKey: "test-key",
    apiUrl: "https://models.example.test/v1/chat/completions",
  }), /require --model/);
});

test("model catalog exposes current recommendations without retired defaults", () => {
  const catalog = formatProviderModelCatalog();
  assert.match(catalog, /gemini-3\.5-flash/);
  assert.match(catalog, /claude-sonnet-4-6/);
  assert.match(catalog, /gpt-5\.4-mini/);
  assert.doesNotMatch(catalog, /gemini-1\.5|claude-3-5|gpt-4\.1-mini/);
});

test("normalizeRepository extracts GitHub slugs from common npm repository values", () => {
  assert.equal(normalizeRepository({ type: "git", url: "git+https://github.com/owner/repo.git" }).github, "owner/repo");
  assert.equal(normalizeRepository("github:owner/repo").github, "owner/repo");
  assert.equal(normalizeRepository("git@github.com:owner/repo.git").display, "github.com/owner/repo");
});
