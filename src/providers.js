const MODEL_CATALOG_VERIFIED_AT = "2026-06-25";

const PROVIDERS = {
  "openai-compatible": {
    family: "chat",
    label: "OpenAI-compatible",
    keyNames: ["NPX_VIBE_API_KEY"],
    defaultUrl: "https://api.openai.com/v1/chat/completions",
    models: {
      fast: "gpt-5.4-nano",
      balanced: "gpt-5.4-mini",
      strong: "gpt-5.5",
    },
    recommendation: "Balanced defaults to an efficient OpenAI model. Custom endpoints should pass --model.",
  },
  openai: {
    family: "chat",
    label: "OpenAI",
    keyNames: ["OPENAI_API_KEY", "NPX_VIBE_API_KEY"],
    defaultUrl: "https://api.openai.com/v1/chat/completions",
    models: {
      fast: "gpt-5.4-nano",
      balanced: "gpt-5.4-mini",
      strong: "gpt-5.5",
    },
    recommendation: "GPT-5.4 mini balances security-review quality, latency, and cost.",
  },
  openrouter: {
    family: "chat",
    label: "OpenRouter",
    keyNames: ["OPENROUTER_API_KEY", "NPX_VIBE_API_KEY"],
    defaultUrl: "https://openrouter.ai/api/v1/chat/completions",
    models: {
      fast: "openrouter/auto",
      balanced: "openrouter/auto",
      strong: "openrouter/auto",
    },
    recommendation: "OpenRouter Auto chooses a suitable current model for each review.",
  },
  groq: {
    family: "chat",
    label: "Groq",
    keyNames: ["GROQ_API_KEY", "NPX_VIBE_API_KEY"],
    defaultUrl: "https://api.groq.com/openai/v1/chat/completions",
    models: {
      fast: "openai/gpt-oss-20b",
      balanced: "openai/gpt-oss-120b",
      strong: "openai/gpt-oss-120b",
    },
    recommendation: "GPT-OSS 120B is a current Groq production model with strong reasoning.",
  },
  together: {
    family: "chat",
    label: "Together AI",
    keyNames: ["TOGETHER_API_KEY", "NPX_VIBE_API_KEY"],
    defaultUrl: "https://api.together.xyz/v1/chat/completions",
    models: {
      fast: "Qwen/Qwen3.5-9B",
      balanced: "Qwen/Qwen3.5-9B",
      strong: "deepseek-ai/DeepSeek-V4-Pro",
    },
    recommendation: "Together currently recommends Qwen3.5 9B to get started; it supports structured output.",
  },
  anthropic: {
    family: "anthropic",
    label: "Anthropic",
    keyNames: ["ANTHROPIC_API_KEY", "NPX_VIBE_API_KEY"],
    defaultUrl: "https://api.anthropic.com/v1/messages",
    models: {
      fast: "claude-haiku-4-5",
      balanced: "claude-sonnet-4-6",
      strong: "claude-opus-4-8",
    },
    recommendation: "Sonnet 4.6 is Anthropic's current speed-and-intelligence balance.",
  },
  gemini: {
    family: "gemini",
    label: "Gemini",
    keyNames: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "NPX_VIBE_API_KEY"],
    defaultUrl: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    models: {
      fast: "gemini-3.1-flash-lite",
      balanced: "gemini-3.5-flash",
      strong: "gemini-3.5-flash",
    },
    recommendation: "Gemini 3.5 Flash is Google's current stable Flash model.",
  },
};

export function providerNames() {
  return Object.keys(PROVIDERS);
}

export function modelProfiles() {
  return ["fast", "balanced", "strong"];
}

export function providerModelCatalog() {
  return Object.entries(PROVIDERS)
    .filter(([name]) => name !== "openai-compatible")
    .map(([name, definition]) => ({
      name,
      label: definition.label,
      models: { ...definition.models },
      recommendation: definition.recommendation,
      verifiedAt: MODEL_CATALOG_VERIFIED_AT,
    }));
}

export function formatProviderModelCatalog() {
  const lines = [
    `npx-vibe model recommendations (verified ${MODEL_CATALOG_VERIFIED_AT})`,
    "",
    "Profile: balanced (default). Override with --model-profile fast|balanced|strong",
    "Any provider model can be selected directly with --model <id>.",
    "",
  ];

  for (const provider of providerModelCatalog()) {
    lines.push(provider.label);
    lines.push(`  fast:     ${provider.models.fast}`);
    lines.push(`  balanced: ${provider.models.balanced}`);
    lines.push(`  strong:   ${provider.models.strong}`);
    lines.push(`  ${provider.recommendation}`);
    lines.push("");
  }

  lines.push("Provider catalogs change. Run this command after upgrading npx-vibe, or pass --model explicitly.");
  return lines.join("\n");
}

export function hasOnlineCredentials(config = {}) {
  if (config.apiKey || config.apiUrl) {
    return true;
  }
  return Object.values(config.apiKeys ?? {}).some(Boolean);
}

export function resolveOnlineProvider(config = {}) {
  const requested = normalizeProviderName(config.provider ?? "auto");
  const detectedName = requested === "auto" ? detectProviderName(config) : requested;
  const name = PROVIDERS[detectedName] ? detectedName : "openai-compatible";
  const definition = PROVIDERS[name];
  const apiKey = config.apiKey ?? firstConfiguredKey(definition, config)?.value ?? null;
  const modelProfile = normalizeModelProfile(config.modelProfile);
  const explicitModel = config.model && config.model !== "auto" ? config.model : null;
  if (name === "openai-compatible" && config.apiUrl && !explicitModel) {
    throw new Error("Custom OpenAI-compatible endpoints require --model <id>.");
  }
  const model = explicitModel ?? definition.models[modelProfile];
  const rawUrl = config.apiUrl ?? definition.defaultUrl;

  return {
    name,
    label: definition.label,
    family: definition.family,
    apiKey,
    model,
    modelProfile,
    modelSource: explicitModel ? "explicit" : `profile:${modelProfile}`,
    recommendation: definition.recommendation,
    catalogVerifiedAt: MODEL_CATALOG_VERIFIED_AT,
    url: rawUrl.replace("{model}", encodeURIComponent(model)),
    keyHint: definition.keyNames.join(" or "),
  };
}

export async function callResolvedProvider(provider, messages, config = {}) {
  if (provider.family === "chat") {
    return fetchJsonLike(provider.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
        "content-type": "application/json",
        ...extraHeaders(provider, config),
      },
      body: JSON.stringify({
        model: provider.model,
        response_format: { type: "json_object" },
        messages,
      }),
      timeoutMs: config.aiTimeoutMs ?? 30_000,
      secrets: [provider.apiKey],
    });
  }

  if (provider.family === "anthropic") {
    return fetchJsonLike(provider.url, {
      method: "POST",
      headers: {
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: Number(config.aiMaxTokens ?? 1_500),
        temperature: 0,
        system: messages.find((message) => message.role === "system")?.content ?? "",
        messages: messages
          .filter((message) => message.role !== "system")
          .map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content })),
      }),
      timeoutMs: config.aiTimeoutMs ?? 30_000,
      secrets: [provider.apiKey],
    });
  }

  if (provider.family === "gemini") {
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    const user = messages
      .filter((message) => message.role !== "system")
      .map((message) => message.content)
      .join("\n\n");

    return fetchJsonLike(provider.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": provider.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
      timeoutMs: config.aiTimeoutMs ?? 30_000,
      secrets: [provider.apiKey],
    });
  }

  throw new Error(`Unsupported provider family: ${provider.family}`);
}

export function extractProviderText(response, provider) {
  if (provider.family === "chat") {
    return response.choices?.[0]?.message?.content;
  }
  if (provider.family === "anthropic") {
    return response.content?.find((part) => part?.type === "text")?.text;
  }
  if (provider.family === "gemini") {
    return response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n");
  }
  return null;
}

function detectProviderName(config) {
  if (config.apiUrl) {
    return "openai-compatible";
  }
  if (config.apiKey) {
    const inferred = inferProviderFromKey(config.apiKey);
    if (!inferred) {
      throw new Error(
        "Could not safely identify the API-key provider. Pass --provider openai|anthropic|gemini|openrouter|groq|together, or use the provider-specific environment variable."
      );
    }
    return inferred;
  }

  for (const [provider, keyName] of [
    ["openai", "OPENAI_API_KEY"],
    ["anthropic", "ANTHROPIC_API_KEY"],
    ["gemini", "GEMINI_API_KEY"],
    ["gemini", "GOOGLE_API_KEY"],
    ["openrouter", "OPENROUTER_API_KEY"],
    ["groq", "GROQ_API_KEY"],
    ["together", "TOGETHER_API_KEY"],
    ["openai-compatible", "NPX_VIBE_API_KEY"],
  ]) {
    if (config.apiKeys?.[keyName]) {
      return provider;
    }
  }

  return "openai";
}

function inferProviderFromKey(apiKey) {
  const key = String(apiKey).trim();
  if (key.startsWith("sk-ant-")) {
    return "anthropic";
  }
  if (key.startsWith("AIza") || key.startsWith("AO.")) {
    return "gemini";
  }
  if (key.startsWith("gsk_")) {
    return "groq";
  }
  if (key.startsWith("sk-or-")) {
    return "openrouter";
  }
  if (key.startsWith("sk-proj-") || key.startsWith("sk-svcacct-")) {
    return "openai";
  }
  return null;
}

function normalizeModelProfile(value) {
  const profile = String(value ?? "balanced").trim().toLowerCase();
  return modelProfiles().includes(profile) ? profile : "balanced";
}

function firstConfiguredKey(definition, config) {
  for (const keyName of definition.keyNames) {
    const value = config.apiKeys?.[keyName];
    if (value) {
      return { keyName, value };
    }
  }
  return null;
}

function extraHeaders(provider, config) {
  if (provider.name !== "openrouter") {
    return {};
  }
  return {
    ...(config.appUrl ? { "HTTP-Referer": config.appUrl } : {}),
    "X-Title": "npx-vibe",
  };
}

function normalizeProviderName(value) {
  const normalized = String(value ?? "auto").trim().toLowerCase();
  if (normalized === "google" || normalized === "google-gemini") {
    return "gemini";
  }
  if (normalized === "claude") {
    return "anthropic";
  }
  if (normalized === "custom") {
    return "openai-compatible";
  }
  return normalized;
}

async function fetchJsonLike(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const safeBody = redactSecrets(body, options.secrets);
      const detail = summarizeErrorBody(safeBody);
      throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
    }

    return response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Timed out after ${options.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function redactSecrets(value, secrets = []) {
  let safe = String(value ?? "");
  for (const secret of secrets.filter(Boolean)) {
    safe = safe.split(String(secret)).join("[REDACTED]");
  }
  return safe;
}

function summarizeErrorBody(body) {
  const text = String(body ?? "").trim();
  if (!text) {
    return "";
  }

  try {
    const parsed = JSON.parse(text);
    const error = parsed?.error ?? parsed;
    const message = error?.message ?? parsed?.message;
    const reason =
      error?.details?.find((detail) => typeof detail?.reason === "string")?.reason ??
      error?.status ??
      parsed?.code;
    if (message) {
      return `${String(message).replace(/\s+/g, " ").trim()}${reason ? ` (${reason})` : ""}`.slice(0, 300);
    }
  } catch {
    // Non-JSON provider errors are normalized below.
  }

  return text.replace(/\s+/g, " ").slice(0, 300);
}
