import test from "node:test";
import assert from "node:assert/strict";
import { callResolvedProvider, formatProviderModelCatalog, resolveOnlineProvider } from "../src/providers.js";
import { normalizeRepository } from "../src/profile.js";

test("resolveOnlineProvider auto-detects provider-specific env keys", () => {
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKeys: { ANTHROPIC_API_KEY: "sk-ant-demo" } }).name, "anthropic");
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKeys: { GEMINI_API_KEY: "AIza-demo" } }).name, "gemini");
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKeys: { GROQ_API_KEY: "gsk_demo" } }).name, "groq");
});

test("resolveOnlineProvider infers provider from direct api key when possible", () => {
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKey: "sk-ant-demo" }).name, "anthropic");
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKey: "AIza-demo" }).name, "gemini");
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKey: "AO.demo-google-auth-key" }).name, "gemini");
  assert.equal(resolveOnlineProvider({ provider: "auto", apiKey: "sk-proj-demo" }).name, "openai");
});

test("resolveOnlineProvider refuses to forward an ambiguous direct key", () => {
  assert.throws(
    () => resolveOnlineProvider({ provider: "auto", apiKey: "unknown-key-format" }),
    /Could not safely identify/
  );
});

test("Gemini uses the API-key header and never puts the key in the URL", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({ candidates: [] }),
    };
  };

  try {
    await callResolvedProvider(
      resolveOnlineProvider({ provider: "auto", apiKey: "AO.demo-google-auth-key" }),
      [{ role: "user", content: "review" }],
      {}
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.doesNotMatch(request.url, /key=/);
  assert.equal(request.options.headers["x-goog-api-key"], "AO.demo-google-auth-key");
});

test("provider errors redact the exact API key", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "sk-proj-secret-that-must-not-be-printed";
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    text: async () => `Incorrect API key provided: ${secret}`,
  });

  try {
    await assert.rejects(
      () => callResolvedProvider(
        resolveOnlineProvider({ provider: "openai", apiKey: secret }),
        [{ role: "user", content: "review" }],
        {}
      ),
      (error) => {
        assert.doesNotMatch(error.message, new RegExp(secret));
        assert.match(error.message, /\[REDACTED\]/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider JSON errors are reduced to an actionable one-line message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    statusText: "Bad Request",
    text: async () => JSON.stringify({
      error: {
        message: "API key expired. Please renew the API key.",
        status: "INVALID_ARGUMENT",
        details: [{ reason: "API_KEY_INVALID" }],
      },
    }),
  });

  try {
    await assert.rejects(
      () => callResolvedProvider(
        resolveOnlineProvider({ provider: "gemini", apiKey: "AO.expired" }),
        [{ role: "user", content: "review" }],
        {}
      ),
      {
        message: "400 Bad Request: API key expired. Please renew the API key. (API_KEY_INVALID)",
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
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
