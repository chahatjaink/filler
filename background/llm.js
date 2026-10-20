import { customOriginPattern, resolveBaseUrl, resolveModel } from "../shared/defaults.js";

function redact(text, apiKey) {
  let output = String(text || "");
  if (apiKey) output = output.split(apiKey).join("***");
  return output.slice(0, 500);
}

function joinUrl(base, path) {
  const root = String(base || "").replace(/\/+$/, "");
  const tail = String(path || "").replace(/^\/+/, "");
  if (root.endsWith("/v1") && tail.startsWith("v1/")) return `${root}/${tail.slice(3)}`;
  return `${root}/${tail}`;
}

async function errorFromResponse(response, apiKey) {
  let text = "";
  try {
    text = await response.text();
  } catch {
    text = "";
  }
  let message = text.slice(0, 400);
  try {
    const body = JSON.parse(text);
    message = body.error?.message || body.error?.status || body.message || message;
  } catch {
    // Keep the raw snippet.
  }
  const detail = redact(message, apiKey);
  if (response.status === 401 || response.status === 403) {
    return `The API rejected the key (${response.status}). ${detail}`;
  }
  return `The model request failed (${response.status}). ${detail}`;
}

function textFromOpenAI(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || part?.content || "").join("");
  }
  return "";
}

function textFromAnthropic(payload) {
  const parts = payload?.content;
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => part?.text || "").join("");
}

function textFromGemini(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    const block = payload?.promptFeedback?.blockReason;
    if (block) throw new Error(`Gemini blocked the request (${block}).`);
    return "";
  }
  return parts.map((part) => part?.text || "").join("");
}

async function postJson(url, { headers, body, signal, apiKey }) {
  const serialized = JSON.stringify(body);
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: serialized,
        signal,
        cache: "no-store"
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new Error(`Could not reach the model API. ${redact(error?.message || error, apiKey)}`);
    }
    if (response.ok) {
      try {
        return await response.json();
      } catch {
        throw new Error("The model API returned a response that was not JSON.");
      }
    }
    lastError = new Error(await errorFromResponse(response, apiKey));
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      if (signal?.aborted) throw signal.reason || new DOMException("Cancelled", "AbortError");
      continue;
    }
    throw lastError;
  }
  throw lastError || new Error("The model request failed.");
}

function openaiBody({ model, system, user, maxTokens, temperature, json, tokenField }) {
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };
  body[tokenField] = maxTokens;
  if (temperature != null) body.temperature = temperature;
  if (json) body.response_format = { type: "json_object" };
  return body;
}

async function completeOpenAI(settings, request, options = {}) {
  const url = joinUrl(settings.baseUrl, "chat/completions");
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${settings.apiKey}`
  };
  let tokenField = options.tokenField || "max_tokens";
  let temperature = request.temperature;
  let json = request.json;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const payload = await postJson(url, {
        headers,
        apiKey: settings.apiKey,
        signal: request.signal,
        body: openaiBody({
          model: settings.model,
          system: request.system,
          user: request.user,
          maxTokens: request.maxTokens,
          temperature,
          json,
          tokenField
        })
      });
      return textFromOpenAI(payload);
    } catch (error) {
      lastError = error;
      if (error?.name === "AbortError") throw error;
      const message = String(error.message || "");
      if (tokenField === "max_tokens" && /max_completion_tokens/i.test(message)) {
        tokenField = "max_completion_tokens";
        continue;
      }
      if (tokenField === "max_completion_tokens" && /max_completion_tokens/i.test(message) && /unknown|unsupported|not support|unrecognized/i.test(message)) {
        tokenField = "max_tokens";
        continue;
      }
      if (temperature != null && /temperature/i.test(message) && /unsupported|not support|only the default/i.test(message)) {
        temperature = null;
        continue;
      }
      if (json && /response_format|json_object/i.test(message)) {
        json = false;
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("The model request failed.");
}

async function completeAnthropic(settings, request) {
  const url = joinUrl(resolveBaseUrl("anthropic", settings.baseUrl), "v1/messages");
  const payload = await postJson(url, {
    apiKey: settings.apiKey,
    signal: request.signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: {
      model: settings.model,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      system: request.system,
      messages: [{ role: "user", content: request.user }]
    }
  });
  return textFromAnthropic(payload);
}

async function completeGemini(settings, request) {
  const model = encodeURIComponent(settings.model);
  const url = joinUrl(
    resolveBaseUrl("gemini", settings.baseUrl),
    `v1beta/models/${model}:generateContent`
  );
  const generationConfig = { maxOutputTokens: request.maxTokens };
  if (request.temperature != null) generationConfig.temperature = request.temperature;
  if (request.json) generationConfig.responseMimeType = "application/json";
  const payload = await postJson(url, {
    apiKey: settings.apiKey,
    signal: request.signal,
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": settings.apiKey
    },
    body: {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: "user", parts: [{ text: request.user }] }],
      generationConfig
    }
  });
  return textFromGemini(payload);
}

export async function complete(settings, request) {
  const provider = settings.provider;
  const prepared = {
    ...settings,
    model: resolveModel(provider, settings.model),
    baseUrl: resolveBaseUrl(provider, settings.baseUrl)
  };
  customOriginPattern(settings.baseUrl, provider);
  if (provider === "anthropic") return completeAnthropic(prepared, request);
  if (provider === "gemini") return completeGemini(prepared, request);
  if (provider === "openai") return completeOpenAI(prepared, request);
  if (provider === "grok") {
    return completeOpenAI(prepared, request, { tokenField: "max_completion_tokens" });
  }
  throw new Error("Choose an API provider on the options page.");
}
