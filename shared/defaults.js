export const PROVIDERS = ["openai", "anthropic", "gemini", "grok"];

export const PROVIDER_LABELS = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  grok: "Grok"
};

export const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-5",
  gemini: "gemini-2.5-flash",
  grok: "grok-4.7"
};

export const DEFAULT_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
  grok: "https://api.x.ai/v1"
};

export const STORAGE_DEFAULTS = {
  provider: "openai",
  apiKey: "",
  model: "",
  baseUrl: "",
  profile: "",
  autoAdvance: false,
  maxSteps: 3
};

export const LIMITS = {
  maxFields: 70,
  maxProfileChars: 24000,
  maxPageChars: 14000,
  maxSteps: 6,
  maxValueChars: 4000
};

export function clampSteps(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.min(LIMITS.maxSteps, Math.max(1, Math.round(n)));
}

export function resolveModel(provider, model) {
  const trimmed = String(model || "").trim();
  if (trimmed) return trimmed.slice(0, 120);
  return DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai;
}

export function resolveBaseUrl(provider, baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_BASE_URLS[provider] || DEFAULT_BASE_URLS.openai;
  return trimmed;
}

export function customOriginPattern(baseUrl, provider) {
  const trimmed = String(baseUrl || "").trim();
  if (!trimmed) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("API base URL is not a valid URL.");
  }
  if (url.username || url.password) {
    throw new Error("Remove credentials from the API URL and paste the key in the API key field.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) {
    throw new Error("API base URL must use https, or http on localhost.");
  }
  const defaults = DEFAULT_BASE_URLS[provider] || DEFAULT_BASE_URLS.openai;
  let defaultOrigin = "";
  try {
    defaultOrigin = new URL(defaults).origin;
  } catch {
    defaultOrigin = "";
  }
  if (url.origin === defaultOrigin) return null;
  return `${url.origin}/*`;
}

export function keyHint(provider, apiKey) {
  const key = String(apiKey || "");
  if (!key) return "";
  if (provider === "anthropic" && !key.startsWith("sk-ant-")) {
    return "Anthropic keys usually start with sk-ant-.";
  }
  if (provider === "openai" && !key.startsWith("sk-")) {
    return "OpenAI keys usually start with sk-. Ignore this if you use a proxy.";
  }
  if (provider === "gemini" && !key.startsWith("AIza")) {
    return "Gemini keys from AI Studio usually start with AIza.";
  }
  if (provider === "grok" && !key.startsWith("xai-")) {
    return "Grok keys from the xAI console usually start with xai-.";
  }
  return "";
}
