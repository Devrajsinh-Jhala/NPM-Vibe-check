import test from "node:test";
import assert from "node:assert/strict";
import { callResolvedProvider, formatProviderCatalog, resolveOnlineProvider } from "../src/providers.js";
import { normalizeRepository } from "../src/profile.js";
import { normalizeAiReview } from "../src/ai.js";
import { decideVerdict } from "../src/verdict.js";

test("resolveOnlineProvider auto-detects provider-specific env keys", () => {
  assert.equal(resolveOnlineProvider({ provider: "auto", model: "m", apiKeys: { ANTHROPIC_API_KEY: "sk-ant-demo" } }).name, "anthropic");
  assert.equal(resolveOnlineProvider({ provider: "auto", model: "m", apiKeys: { GEMINI_API_KEY: "AIza-demo" } }).name, "gemini");
  assert.equal(resolveOnlineProvider({ provider: "auto", model: "m", apiKeys: { GROQ_API_KEY: "gsk_demo" } }).name, "groq");
});

test("resolveOnlineProvider infers provider from direct api key when possible", () => {
  assert.equal(resolveOnlineProvider({ provider: "auto", model: "m", apiKey: "sk-ant-demo" }).name, "anthropic");
  assert.equal(resolveOnlineProvider({ provider: "auto", model: "m", apiKey: "AIza-demo" }).name, "gemini");
  assert.equal(resolveOnlineProvider({ provider: "auto", model: "m", apiKey: "AO.demo-google-auth-key" }).name, "gemini");
  assert.equal(resolveOnlineProvider({ provider: "auto", model: "m", apiKey: "sk-proj-demo" }).name, "openai");
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
      resolveOnlineProvider({ provider: "auto", model: "m", apiKey: "AO.demo-google-auth-key" }),
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
        resolveOnlineProvider({ provider: "openai", apiKey: secret, model: "test-model" }),
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
        resolveOnlineProvider({ provider: "gemini", apiKey: "AO.expired", model: "test-model" }),
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

test("AI findings are matched back to inspected source evidence", () => {
  const review = normalizeAiReview(JSON.stringify({
    riskScore: 62,
    confidence: "high",
    recommendedVerdict: "caution",
    summary: "Install-time process execution deserves review.",
    findings: [{
      severity: "high",
      file: "install.js",
      line: 2,
      evidence: "child_process.execSync(command)",
      rationale: "The installer launches a shell command.",
    }],
  }), { provider: "test", model: "test-model" }, {
    selectedFiles: [{
      path: "install.js",
      text: "const child_process = require('child_process');\nchild_process.execSync(command);",
    }],
  });

  assert.equal(review.findings[0].evidenceVerified, true);
  assert.equal(review.evidenceSufficientForBlock, true);
  assert.equal(review.evidenceCoverage, 1);
});

test("unsupported AI block recommendations are reduced to caution", () => {
  const review = normalizeAiReview(JSON.stringify({
    riskScore: 99,
    confidence: "high",
    recommendedVerdict: "block",
    summary: "Claims unsupported behavior.",
    findings: [{
      severity: "critical",
      file: "missing.js",
      line: 1,
      evidence: "stealEverything()",
      rationale: "Unsupported.",
    }],
  }), { provider: "test", model: "test-model" }, {
    selectedFiles: [{ path: "install.js", text: "console.log('safe')" }],
  });

  assert.equal(review.findings[0].evidenceVerified, false);
  assert.equal(review.recommendedVerdict, "caution");
  assert.equal(review.confidence, "low");
  const verdict = decideVerdict({
    staticScore: 0,
    needsAi: true,
    findings: [],
  }, review);
  assert.equal(verdict.verdict, "caution");
  assert.ok(verdict.score < 70);
});

test("every provider requires an explicit model", () => {
  // No catalog is bundled, so there is no default to silently rot.
  for (const provider of ["gemini", "anthropic", "openai", "groq", "together", "openrouter"]) {
    assert.throws(
      () => resolveOnlineProvider({ provider, apiKey: "demo-key" }),
      /needs an explicit model/,
      `${provider} should demand --model`
    );
  }
});

test("an explicit model is used verbatim and reported as explicit", () => {
  const gemini = resolveOnlineProvider({
    provider: "gemini",
    apiKey: "AIza-demo",
    model: "gemini-custom-preview",
  });
  assert.equal(gemini.model, "gemini-custom-preview");
  assert.equal(gemini.modelSource, "explicit");
  // The Gemini endpoint interpolates the model into the URL path.
  assert.match(gemini.url, /models\/gemini-custom-preview:generateContent/);
  assert.equal(resolveOnlineProvider({ provider: "anthropic", apiKey: "sk-ant-demo", model: "x" }).model, "x");
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
  }), /needs an explicit model/);
});

test("the provider catalog names keys and model docs, never model ids", () => {
  const catalog = formatProviderCatalog();
  assert.match(catalog, /ANTHROPIC_API_KEY/);
  assert.match(catalog, /docs\.anthropic\.com/);
  assert.match(catalog, /ai\.google\.dev/);
  // A bundled id is exactly what this release removed.
  assert.doesNotMatch(catalog, /gemini-[0-9]|claude-[a-z]+-[0-9]|gpt-[0-9]/);
});

test("normalizeRepository extracts GitHub slugs from common npm repository values", () => {
  assert.equal(normalizeRepository({ type: "git", url: "git+https://github.com/owner/repo.git" }).github, "owner/repo");
  assert.equal(normalizeRepository("github:owner/repo").github, "owner/repo");
  assert.equal(normalizeRepository("git@github.com:owner/repo.git").display, "github.com/owner/repo");
});
