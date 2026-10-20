import { complete } from "./llm.js";
import { fillMessages, summaryMessages } from "./prompts.js";
import { parseModelJson } from "./parse-json.js";
import { constrainFills, normalizeSummary, sanitizeFills } from "./normalize.js";
import {
  LIMITS,
  PROVIDERS,
  STORAGE_DEFAULTS,
  clampSteps,
  resolveBaseUrl,
  resolveModel
} from "../shared/defaults.js";

const ISOLATED_FILES = ["content/dom.js", "content/extract.js"];
const MAIN_FILES = ["content/dom.js", "content/match.js", "content/fill.js"];

let generation = 0;
let activeAbort = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error("Cancelled");
    error.name = "AbortError";
    throw error;
  }
}

function safePost(port, message) {
  try {
    port.postMessage(message);
  } catch {
    // The popup closed. The fill can still finish on the page.
  }
}

function progress(port, message) {
  safePost(port, { type: "PROGRESS", message });
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_DEFAULTS);
  const provider = PROVIDERS.includes(stored.provider) ? stored.provider : "openai";
  return {
    provider,
    apiKey: String(stored.apiKey || "").trim(),
    model: resolveModel(provider, stored.model),
    baseUrl: resolveBaseUrl(provider, stored.baseUrl),
    rawBaseUrl: String(stored.baseUrl || "").trim(),
    profile: String(stored.profile || ""),
    autoAdvance: Boolean(stored.autoAdvance),
    maxSteps: clampSteps(stored.maxSteps)
  };
}

function requireKey(settings) {
  if (!settings.apiKey) {
    throw new Error("Add your API key on the options page.");
  }
}

function requireProfile(settings) {
  if (!settings.profile.trim()) {
    throw new Error("Add your resume and preferences on the options page.");
  }
}

function extensionPage(sender) {
  const url = sender?.url || "";
  return url.startsWith(chrome.runtime.getURL(""));
}

function probeFrame() {
  const selector = [
    "input",
    "textarea",
    "select",
    "button[aria-haspopup]",
    "[role='combobox']",
    "[role='textbox']",
    "[role='checkbox']",
    "[role='radio']",
    "[role='spinbutton']",
    "[contenteditable='true']",
    "[data-automation-id^='formField']"
  ].join(",");

  function count(root, depth) {
    if (!root || depth > 4 || !root.querySelectorAll) return 0;
    let total = 0;
    try {
      total = root.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
    if (total > 0) return total;
    const nodes = root.querySelectorAll("*");
    for (const node of nodes) {
      if (!node.shadowRoot) continue;
      total += count(node.shadowRoot, depth + 1);
      if (total > 0) return total;
    }
    return total;
  }

  return {
    href: location.href,
    title: document.title || "",
    count: count(document, 0)
  };
}

function runExtract() {
  const api = globalThis.FillerExtract;
  if (!api) return { fields: [], manual: [], error: "Filler could not start in this frame." };
  return api.extractForm();
}

function runPageText() {
  const api = globalThis.FillerExtract;
  if (!api) return { title: document.title || "", url: location.href, text: "" };
  return api.extractPageText();
}

function runApply(payload) {
  const api = globalThis.FillerFill;
  if (!api) return { filled: [], skipped: [{ label: "Frame", reason: "Filler could not start in this frame." }] };
  return api.applyFills(payload);
}

function runNext() {
  const api = globalThis.FillerFill;
  if (!api) return { clicked: false };
  return api.clickNext();
}

async function scriptingCall(tabId, frameId, world, func, args = []) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world,
    func,
    args
  });
  return result?.result;
}

async function probe(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: probeFrame
    });
    return results.map((result) => ({
      frameId: result.frameId,
      ...(result.result || { href: "", title: "", count: 0 })
    }));
  } catch {
    const top = await chrome.scripting.executeScript({
      target: { tabId },
      func: probeFrame
    });
    return top.map((result) => ({
      frameId: result.frameId,
      ...(result.result || { href: "", title: "", count: 0 })
    }));
  }
}

function usableFrame(frame) {
  const href = frame.href || "";
  if (!href || href.startsWith("chrome") || href.startsWith("about:blank") && !frame.count) return false;
  if (href.startsWith("devtools://")) return false;
  return true;
}

async function inject(tabId, frameId, world, files) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world,
    files
  });
}

async function prepareCss(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: true },
      files: ["content/content.css"]
    });
  } catch {
    // Highlighting is optional when a frame refuses extension CSS.
  }
}

async function extractAll(tabId) {
  const frames = (await probe(tabId)).filter(usableFrame);
  const interesting = frames.filter((frame) => frame.count > 0);
  const targets = interesting.length ? interesting : frames.filter((frame) => frame.frameId === 0);
  const fields = [];
  const manual = [];
  let title = "";
  let url = "";
  let lang = "";
  let lastError = "";

  for (const frame of targets) {
    try {
      await inject(tabId, frame.frameId, "ISOLATED", ISOLATED_FILES);
      const data = await scriptingCall(tabId, frame.frameId, "ISOLATED", runExtract);
      if (!data) continue;
      if (data.error) lastError = data.error;
      if (!title && data.title) title = data.title;
      if (!url && data.url) url = data.url;
      if (!lang && data.lang) lang = data.lang;
      for (const field of data.fields || []) {
        fields.push({ ...field, frameId: frame.frameId, fieldId: `${frame.frameId}:${field.localId}` });
      }
      for (const file of data.manual || []) manual.push(file);
    } catch (error) {
      lastError = error?.message || String(error);
    }
  }

  return {
    fields,
    manual,
    title,
    url,
    lang,
    frameIds: [...new Set(fields.map((field) => field.frameId))],
    error: lastError
  };
}

function signatureOf(fields) {
  return fields.map((field) => `${field.kind}:${field.label}`).join("\n");
}

function dedupeManual(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item.label || item.reason;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function askForFills(settings, fields, meta, signal, { repair = false } = {}) {
  const messages = fillMessages({
    profile: settings.profile,
    fields,
    title: meta.title,
    url: meta.url,
    lang: meta.lang,
    today: new Date().toISOString().slice(0, 10),
    repair
  });
  const request = {
    system: messages.system,
    user: messages.user,
    json: true,
    temperature: repair ? 0.1 : 0.2,
    maxTokens: 4096,
    signal
  };
  const allowed = new Set(fields.map((field) => field.fieldId));
  const finish = (text) => constrainFills(sanitizeFills(parseModelJson(text), allowed), fields);
  let text = await complete(settings, request);
  try {
    return finish(text);
  } catch {
    throwIfAborted(signal);
    text = await complete(settings, {
      ...request,
      user: `Return only a JSON object {"fills":[{"fieldId":"...","value":"..."}]}. Convert this into that shape and drop anything you cannot parse:\n${String(text).slice(0, 8000)}`
    });
    return finish(text);
  }
}

function replaceFilled(filled, updates) {
  const byLabel = new Map(updates.map((item) => [item.label, item]));
  const next = filled.map((item) => byLabel.get(item.label) || item);
  for (const item of updates) {
    if (!filled.some((existing) => existing.label === item.label)) next.push(item);
  }
  return next;
}

async function repairStep(tabId, port, settings, signal) {
  throwIfAborted(signal);
  await sleep(500);
  const extracted = await extractAll(tabId);
  const broken = extracted.fields.filter((field) => field.error).slice(0, LIMITS.maxFields);
  if (!broken.length) return { filled: [], skipped: [], note: "", fixed: false, considered: 0 };
  progress(port, `Correcting ${broken.length} field${broken.length === 1 ? "" : "s"} the form still rejects…`);
  const answer = await askForFills(settings, broken, extracted, signal, { repair: true });
  const report = await applyAll(tabId, broken, answer.fills);
  return {
    filled: report.filled,
    skipped: report.skipped,
    note: answer.note,
    fixed: report.filled.length > 0,
    considered: broken.length
  };
}

async function applyAll(tabId, fields, fills) {
  const schema = new Map(fields.map((field) => [field.fieldId, field]));
  const byFrame = new Map();
  for (const fill of fills) {
    const field = schema.get(fill.fieldId);
    if (!field) continue;
    if (!byFrame.has(field.frameId)) byFrame.set(field.frameId, []);
    byFrame.get(field.frameId).push({ localId: field.localId, value: fill.value });
  }

  const filled = [];
  const skipped = [];
  for (const [frameId, payload] of byFrame) {
    try {
      await inject(tabId, frameId, "MAIN", MAIN_FILES);
      const report = await scriptingCall(tabId, frameId, "MAIN", runApply, [payload]);
      filled.push(...(report?.filled || []));
      skipped.push(...(report?.skipped || []));
    } catch (error) {
      skipped.push({ label: "Frame", reason: error?.message || "Could not write into this frame." });
    }
  }
  return { filled, skipped };
}

async function goToNextStep(tabId, frameIds) {
  const ordered = [...frameIds];
  if (!ordered.includes(0)) ordered.unshift(0);
  for (const frameId of ordered) {
    try {
      await inject(tabId, frameId, "MAIN", MAIN_FILES);
      const result = await scriptingCall(tabId, frameId, "MAIN", runNext);
      if (result?.clicked) return result;
    } catch {
      // This frame may have navigated away.
    }
  }
  return { clicked: false };
}

async function waitForChange(tabId, previousSignature, signal) {
  const started = Date.now();
  let sawNavigation = false;
  const onUpdated = (id, info) => {
    if (id === tabId && info.status === "loading") sawNavigation = true;
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
  try {
    while (Date.now() - started < 8000) {
      throwIfAborted(signal);
      await sleep(450);
      if (sawNavigation && Date.now() - started < 700) continue;
      try {
        const extracted = await extractAll(tabId);
        const signature = signatureOf(extracted.fields);
        if (signature && signature !== previousSignature) return extracted;
      } catch {
        // The next document is still loading.
      }
    }
  } finally {
    chrome.tabs.onUpdated.removeListener(onUpdated);
  }
  return null;
}

async function runFill(tabId, port, signal, message) {
  const settings = await loadSettings();
  requireKey(settings);
  requireProfile(settings);
  const advance = Boolean(message.autoAdvance);
  const maxSteps = advance ? settings.maxSteps : 1;
  const seen = new Set();
  const filled = [];
  const skipped = [];
  const manual = [];
  const notes = [];
  let steps = 0;
  let considered = 0;
  let truncated = false;

  while (steps < maxSteps) {
    throwIfAborted(signal);
    steps += 1;
    progress(port, steps === 1 ? "Scanning fields…" : `Scanning step ${steps}…`);
    const extracted = await extractAll(tabId);
    manual.push(...extracted.manual);
    if (!extracted.fields.length) {
      if (steps === 1) {
        throw new Error(extracted.error
          ? "Filler couldn't read this page. Reload it, then try again."
          : "No fillable fields found. Wait for the form to finish loading, then try again.");
      }
      break;
    }
    const signature = signatureOf(extracted.fields);
    if (seen.has(signature)) break;
    seen.add(signature);

    const batch = extracted.fields.slice(0, LIMITS.maxFields);
    if (extracted.fields.length > batch.length) truncated = true;
    considered += batch.length;
    progress(port, `Asking ${settings.model} about ${batch.length} field${batch.length === 1 ? "" : "s"}…`);
    const answer = await askForFills(settings, batch, extracted, signal);
    if (answer.note) notes.push(answer.note);
    progress(port, answer.fills.length
      ? `Filling ${answer.fills.length} answer${answer.fills.length === 1 ? "" : "s"}…`
      : "The model left this step blank.");
    const report = await applyAll(tabId, batch, answer.fills);
    filled.splice(0, filled.length, ...replaceFilled(filled, report.filled));
    skipped.push(...report.skipped);

    const repair = await repairStep(tabId, port, settings, signal);
    considered += repair.considered;
    if (repair.note) notes.push(repair.note);
    filled.splice(0, filled.length, ...replaceFilled(filled, repair.filled));
    skipped.push(...repair.skipped);

    if (!advance || steps >= maxSteps) break;
    const frames = extracted.frameIds.length ? extracted.frameIds : [0];
    progress(port, "Looking for a Next button…");
    let moved = await goToNextStep(tabId, frames);
    if (!moved.clicked) break;
    progress(port, `Waiting after “${moved.label || "Next"}”…`);
    let next = await waitForChange(tabId, signature, signal);
    if (!next) {
      progress(port, "Still on this step. Checking the errors it showed…");
      const again = await repairStep(tabId, port, settings, signal);
      considered += again.considered;
      if (again.note) notes.push(again.note);
      filled.splice(0, filled.length, ...replaceFilled(filled, again.filled));
      skipped.push(...again.skipped);
      if (!again.fixed) break;
      moved = await goToNextStep(tabId, frames);
      if (!moved.clicked) break;
      progress(port, `Waiting after “${moved.label || "Next"}”…`);
      next = await waitForChange(tabId, signature, signal);
      if (!next) break;
    }
  }

  const result = {
    filled,
    skipped,
    manual: dedupeManual(manual),
    steps,
    considered,
    truncated,
    note: notes.filter(Boolean).join(" ")
  };
  try {
    await chrome.storage.session.set({ [`result:${tabId}`]: { at: Date.now(), mode: "FILL", result } });
  } catch {
    // Session storage can be unavailable in older profiles.
  }
  return result;
}

function choosePage(pages) {
  const ranked = pages.filter((page) => page.text && page.text.length > 40)
    .sort((a, b) => b.text.length - a.text.length);
  if (!ranked.length) return pages[0] || { title: "", url: "", text: "" };
  const top = pages.find((page) => page.frameId === 0);
  const best = ranked[0];
  if (top?.text && top.text.length > 400 && top.text.length >= best.text.length * 0.5) return top;
  return best;
}

async function collectPageText(tabId) {
  const frames = (await probe(tabId)).filter(usableFrame);
  const pages = [];
  for (const frame of frames) {
    try {
      await inject(tabId, frame.frameId, "ISOLATED", ISOLATED_FILES);
      const data = await scriptingCall(tabId, frame.frameId, "ISOLATED", runPageText);
      if (data?.text) pages.push({ ...data, frameId: frame.frameId });
    } catch {
      // Ignore frames that disappear mid-read.
    }
  }
  return choosePage(pages);
}

async function runSummary(tabId, port, signal) {
  const settings = await loadSettings();
  requireKey(settings);
  progress(port, "Reading the page…");
  const page = await collectPageText(tabId);
  if (!page.text || page.text.length < 40) {
    throw new Error("This page doesn't have enough text to summarize.");
  }
  progress(port, `Summarizing with ${settings.model}…`);
  const messages = summaryMessages({
    profile: settings.profile,
    title: page.title,
    url: page.url,
    text: page.text
  });
  let text = "";
  try {
    text = await complete(settings, {
      system: messages.system,
      user: messages.user,
      json: true,
      temperature: 0.3,
      maxTokens: 1200,
      signal
    });
    const result = normalizeSummary(parseModelJson(text), text);
    await chrome.storage.session.set({ [`result:${tabId}`]: { at: Date.now(), mode: "SUMMARIZE", result } });
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    if (!text) throw error;
    return normalizeSummary(null, text);
  }
}

async function testConnection(settings, signal) {
  const provider = PROVIDERS.includes(settings.provider) ? settings.provider : "openai";
  const prepared = {
    provider,
    apiKey: String(settings.apiKey || "").trim(),
    model: resolveModel(provider, settings.model),
    baseUrl: resolveBaseUrl(provider, settings.baseUrl),
    rawBaseUrl: String(settings.baseUrl || "").trim()
  };
  requireKey(prepared);
  const text = await complete(prepared, {
    system: "Reply with the word ok.",
    user: "ping",
    json: false,
    temperature: 0,
    maxTokens: 16,
    signal
  });
  if (!String(text || "").trim()) throw new Error("The model returned an empty response.");
  return { ok: true, model: prepared.model };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!extensionPage(sender)) return false;

  if (message?.type === "GET_STATUS") {
    loadSettings()
      .then((settings) => {
        sendResponse({
          ok: true,
          provider: settings.provider,
          model: settings.model,
          hasKey: Boolean(settings.apiKey),
          profileChars: settings.profile.trim().length,
          autoAdvance: settings.autoAdvance,
          maxSteps: settings.maxSteps
        });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "TEST_CONNECTION") {
    if (!(sender.url || "").startsWith(chrome.runtime.getURL("options/"))) {
      sendResponse({ ok: false, error: "Open the options page to test a key." });
      return false;
    }
    const abort = new AbortController();
    const testLimit = message.settings?.provider === "grok" ? 60000 : 25000;
    const timer = setTimeout(() => abort.abort(), testLimit);
    testConnection(message.settings || {}, abort.signal)
      .then((result) => sendResponse(result))
      .catch((error) => {
        const aborted = error?.name === "AbortError";
        sendResponse({ ok: false, error: aborted ? "The test timed out." : error.message });
      })
      .finally(() => clearTimeout(timer));
    return true;
  }

  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "filler") return;
  if (!extensionPage(port.sender)) {
    port.disconnect();
    return;
  }

  port.onMessage.addListener((message) => {
    if (!message || (message.type !== "FILL" && message.type !== "SUMMARIZE" && message.type !== "CANCEL")) return;
    if (message.type === "CANCEL") {
      activeAbort?.abort();
      return;
    }
    if (!Number.isInteger(message.tabId)) {
      safePost(port, { type: "ERROR", message: "Open the application tab first." });
      return;
    }

    activeAbort?.abort();
    const runId = ++generation;
    const abort = new AbortController();
    activeAbort = abort;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, message.type === "FILL" ? 180000 : 45000);
    const job = message.type === "FILL"
      ? runFill(message.tabId, port, abort.signal, message)
      : runSummary(message.tabId, port, abort.signal);

    job.then((result) => {
      if (runId !== generation) return;
      safePost(port, { type: "DONE", mode: message.type, result });
    }).catch((error) => {
      if (runId !== generation) return;
      if (error?.name === "AbortError") {
        safePost(port, {
          type: "ERROR",
          message: timedOut ? "The model took too long. Try again or use a faster model." : "Cancelled."
        });
        return;
      }
      const detail = String(error?.message || "Something went wrong.").slice(0, 500);
      const hint = /Cannot access contents|The extensions gallery|Frame with ID/i.test(detail)
        ? " Reload the tab and allow site access."
        : "";
      safePost(port, { type: "ERROR", message: `${detail}${hint}` });
    }).finally(() => clearTimeout(timer));
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
