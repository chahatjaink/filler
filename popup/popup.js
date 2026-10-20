import { PROVIDER_LABELS } from "../shared/defaults.js";

const setup = document.querySelector("#setup");
const setupCopy = document.querySelector("#setup-copy");
const ready = document.querySelector("#ready");
const meta = document.querySelector("#meta");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const fillButton = document.querySelector("#fill");
const summarizeButton = document.querySelector("#summarize");
const cancelButton = document.querySelector("#cancel");
const advanceBox = document.querySelector("#advance");

let port = null;
let currentTabId = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setStatus(message, kind) {
  status.textContent = message || "";
  status.className = `status${kind ? ` ${kind}` : ""}`;
}

function clearResult() {
  result.replaceChildren();
  result.className = "";
}

function pageProblem(url) {
  if (!url) return "Open the job application tab first.";
  if (/^(chrome|edge|about|devtools):/i.test(url) || url.startsWith("chrome-extension://")) {
    return "This page can’t be edited. Open the application in a normal tab.";
  }
  if (!/^https?:/i.test(url)) {
    return "Open an http(s) page. For the included demo, serve the demo folder on localhost.";
  }
  return "";
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function renderSummary(summary) {
  clearResult();
  result.className = "result";
  if (summary.role || summary.location || summary.compensation) {
    const facts = el("div", "facts");
    for (const fact of [summary.role, summary.location, summary.compensation]) {
      if (fact) facts.append(el("span", "", fact));
    }
    result.append(facts);
  }
  result.append(el("p", "", summary.summary || "No summary returned."));
  if (summary.highlights?.length) {
    const list = el("ul");
    for (const item of summary.highlights) list.append(el("li", "", item));
    result.append(list);
  }
  if (summary.fit?.length) {
    result.append(el("p", "quiet", "From your profile"));
    const list = el("ul");
    for (const item of summary.fit) list.append(el("li", "", item));
    result.append(list);
  }
  const copy = el("button", "text-button", "Copy summary");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    const lines = [summary.summary, ...(summary.highlights || [])].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Copy failed";
    }
  });
  result.append(copy);
}

function renderFill(report) {
  clearResult();
  result.className = "result";
  const headline = `Filled ${report.filled.length}${report.considered ? ` of ${report.considered}` : ""}`;
  result.append(el("h2", "", headline));
  if (report.truncated) {
    result.append(el("p", "quiet", "Only the first 70 fields were sent. Run Fill again for the rest."));
  }
  if (report.note) result.append(el("p", "", report.note));
  if (report.filled.length) {
    const list = el("ul");
    for (const item of report.filled.slice(0, 12)) {
      list.append(el("li", "", `${item.label}: ${item.value}`));
    }
    if (report.filled.length > 12) list.append(el("li", "quiet", `${report.filled.length - 12} more`));
    result.append(list);
  } else if (!report.note) {
    result.append(el("p", "", "The model didn’t have answers in your profile for these fields."));
  }
  if (report.manual?.length) {
    result.append(el("p", "quiet", "Needs you"));
    const list = el("ul");
    for (const item of report.manual) list.append(el("li", "", `${item.label}. ${item.reason}`));
    result.append(list);
  }
  if (report.skipped?.length) {
    result.append(el("p", "quiet", "Skipped"));
    const list = el("ul");
    for (const item of report.skipped.slice(0, 8)) {
      list.append(el("li", "", `${item.label}: ${item.reason}`));
    }
    result.append(list);
  }
  if (report.steps > 1) result.append(el("p", "quiet", `${report.steps} steps.`));
}

function setBusy(busy) {
  document.body.classList.toggle("is-busy", busy);
  fillButton.disabled = busy || fillButton.dataset.needsProfile === "true";
  summarizeButton.disabled = busy;
  cancelButton.hidden = !busy;
}

function connect() {
  if (port) return port;
  port = chrome.runtime.connect({ name: "filler" });
  port.onMessage.addListener((message) => {
    if (message.type === "PROGRESS") {
      setStatus(message.message);
      return;
    }
    setBusy(false);
    if (message.type === "ERROR") {
      setStatus(message.message, "bad");
      return;
    }
    if (message.type === "DONE" && message.mode === "SUMMARIZE") {
      setStatus("Summary ready.", "ok");
      renderSummary(message.result || {});
      return;
    }
    if (message.type === "DONE") {
      setStatus("Form updated.", "ok");
      renderFill(message.result || { filled: [], skipped: [], manual: [] });
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
    setBusy(false);
  });
  return port;
}

function start(type) {
  clearResult();
  setBusy(true);
  setStatus(type === "FILL" ? "Starting…" : "Starting summary…");
  connect().postMessage({
    type,
    tabId: currentTabId,
    autoAdvance: advanceBox.checked
  });
}

async function restore(tabId) {
  try {
    const stored = await chrome.storage.session.get(`result:${tabId}`);
    const saved = stored[`result:${tabId}`];
    if (!saved || Date.now() - saved.at > 30 * 60 * 1000) return;
    if (saved.mode === "SUMMARIZE") renderSummary(saved.result);
    if (saved.mode === "FILL") renderFill(saved.result);
  } catch {
    // Session results are optional.
  }
}

async function refresh() {
  let tab = null;
  let statusResponse = null;
  try {
    tab = await activeTab();
    statusResponse = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  } catch (error) {
    setStatus(error?.message || "Filler couldn’t read its settings.", "bad");
    return;
  }
  currentTabId = tab?.id ?? null;
  const problem = pageProblem(tab?.url || "");
  advanceBox.checked = Boolean(statusResponse?.autoAdvance);

  if (!statusResponse?.ok || !statusResponse.hasKey) {
    setup.hidden = false;
    ready.hidden = true;
    setupCopy.textContent = "Add an API key before filling a form or summarizing a page.";
    return;
  }

  setup.hidden = true;
  ready.hidden = false;
  const provider = PROVIDER_LABELS[statusResponse.provider] || "Model";
  fillButton.dataset.needsProfile = statusResponse.profileChars ? "" : "true";
  fillButton.disabled = !statusResponse.profileChars;
  meta.textContent = statusResponse.profileChars
    ? `${provider} · ${statusResponse.model} · ${statusResponse.profileChars.toLocaleString()} characters saved`
    : `${provider} · ${statusResponse.model} · Add your background in settings to fill forms.`;
  if (problem) setStatus(problem, "bad");
  else setStatus("");
  if (currentTabId != null) await restore(currentTabId);
}

function begin(type) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    const problem = pageProblem(tab?.url || "");
    if (problem) {
      setStatus(problem, "bad");
      return;
    }
    currentTabId = tab.id;
    start(type);
  });
}

function arm(type) {
  chrome.permissions.request({ origins: ["https://*/*", "http://*/*"] }, () => begin(type));
}

fillButton.addEventListener("click", () => arm("FILL"));
summarizeButton.addEventListener("click", () => arm("SUMMARIZE"));

cancelButton.addEventListener("click", () => {
  port?.postMessage({ type: "CANCEL" });
  setBusy(false);
  setStatus("Cancelled.");
});

advanceBox.addEventListener("change", () => {
  chrome.storage.local.set({ autoAdvance: advanceBox.checked });
});

document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#open-setup").addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh();
