import { spawn } from "node:child_process";
import { cpSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(root, ".live-ext");
const profileDir = path.join(root, ".chrome-profile");
const shotPath = path.join(root, ".live-shot.png");
const formUrl = "http://127.0.0.1:8765/demo/application.html";
const debugPort = 9333;
const mockPort = 8787;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function answerFor(field) {
  const label = String(field.label || "").toLowerCase();
  if (field.kind === "checkbox" && label.includes("sponsorship")) return false;
  if (label.includes("first name")) return "Ada";
  if (label.includes("last name")) return "Lovelace";
  if (label.includes("email")) return "ada@example.com";
  if (label.includes("phone")) return "+1 415 555 0130";
  if (label.includes("degree")) return "Bachelor's degree";
  if (label.includes("authorized")) return "Yes";
  if (label.includes("hear")) return "Company website";
  if (label.includes("why")) return "I build calculation tools and explain them clearly.";
  if (label.includes("city")) return "London";
  if (label.includes("website")) return "https://ada.example";
  return null;
}

function mockReply(body) {
  const user = body?.messages?.find((message) => message.role === "user")?.content || "";
  if (user.includes("PAGE TEXT:")) {
    return {
      summary: "Example Company is hiring an Analytical Engineer in London or remote.",
      highlights: ["Mathematics, algorithms, and technical writing are required."],
      role: "Analytical Engineer",
      location: "London or remote",
      compensation: "£90,000–£110,000",
      fit: []
    };
  }
  const marker = "FORM SCHEMA:\n";
  const start = user.indexOf(marker);
  if (start < 0) return { fills: [] };
  const schema = JSON.parse(user.slice(start + marker.length));
  const fills = [];
  for (const field of schema.fields || []) {
    const value = answerFor(field);
    if (value == null) continue;
    fills.push({ fieldId: field.fieldId, value });
  }
  return { fills, note: "Filled from the localhost profile." };
}

function startMock() {
  const server = http.createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "POST, OPTIONS"
      });
      response.end();
      return;
    }
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
      const payload = mockReply(body);
      const content = JSON.stringify(payload);
      console.log(`mock ${request.url} -> ${content.slice(0, 180)}`);
      response.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(mockPort, "127.0.0.1", () => resolve(server));
  });
}

function stageExtension() {
  rmSync(extensionDir, { recursive: true, force: true });
  for (const entry of ["background", "content", "popup", "options", "shared", "icons", "manifest.json"]) {
    cpSync(path.join(root, entry), path.join(extensionDir, entry), { recursive: true });
  }
  const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
  manifest.host_permissions = [
    ...(manifest.host_permissions || []),
    "http://127.0.0.1/*",
    "http://localhost/*"
  ];
  writeFileSync(path.join(extensionDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  mkdirSync(path.join(extensionDir, "drive"), { recursive: true });
  writeFileSync(path.join(extensionDir, "drive", "drive.html"), `<!doctype html>
<meta charset="utf-8">
<title>Filler drive</title>
<pre id="out">starting</pre>
<script type="module">
const out = document.querySelector("#out");
const messages = [];
function show(message) {
  messages.push(message);
  out.textContent = JSON.stringify(messages, null, 2);
  document.body.dataset.state = message.type || "note";
  if (message.type === "ERROR" || (message.type === "DONE" && message.mode === "SUMMARIZE")) {
    document.body.dataset.done = "yes";
  }
}
try {
  await chrome.storage.local.set({
    provider: "openai",
    apiKey: "test-key",
    model: "mock-model",
    baseUrl: "http://127.0.0.1:${mockPort}/v1",
    profile: "Ada Lovelace, ada@example.com, authorized to work in the United Kingdom, no sponsorship.",
    autoAdvance: true,
    maxSteps: 3
  });
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((item) => (item.url || "").startsWith("http://127.0.0.1:8765/demo/"));
  if (!tab) {
    show({ type: "ERROR", message: "Form tab not found", tabs: tabs.map((item) => item.url) });
  } else {
    const port = chrome.runtime.connect({ name: "filler" });
    let filled = false;
    port.onMessage.addListener((message) => {
      show(message);
      if (!filled && message.type === "DONE" && message.mode === "FILL") {
        filled = true;
        port.postMessage({ type: "SUMMARIZE", tabId: tab.id });
      }
    });
    port.postMessage({ type: "FILL", tabId: tab.id, autoAdvance: true });
  }
} catch (error) {
  show({ type: "ERROR", message: error.message });
}
</script>
`);
}

function launchChrome() {
  rmSync(profileDir, { recursive: true, force: true });
  const chrome = spawn(chromePath, [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--window-size=1100,900",
    formUrl
  ], { stdio: ["ignore", "ignore", openSync(path.join(root, ".chrome-log.txt"), "w")] });
  return chrome;
}

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  if (!response.ok) throw new Error(`DevTools list returned ${response.status}`);
  return response.json();
}

async function waitForTargets() {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const targets = await listTargets();
      const page = targets.find((target) => target.type === "page" && target.url.startsWith(formUrl));
      if (page) return targets;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Chrome did not open the form.");
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") {
        console.log("page exception", message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text);
      }
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.next;
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return result;
  }
}

async function connect(url, { runtime = true } = {}) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const cdp = new Cdp(ws);
  if (runtime) await cdp.send("Runtime.enable");
  return { ws, cdp };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    throw new Error(details.exception?.description || details.text || "Evaluation failed");
  }
  return result.result?.value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const mock = await startMock();
  stageExtension();
  const chrome = launchChrome();
  let failed = null;
  try {
    await waitForTargets();
    const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
    const browser = await connect(version.webSocketDebuggerUrl, { runtime: false });
    const loaded = await browser.cdp.send("Extensions.loadUnpacked", { path: extensionDir });
    console.log(`loaded extension ${loaded.id}`);
    let extensionTarget = null;
    const loadStarted = Date.now();
    while (Date.now() - loadStarted < 10000) {
      const list = await listTargets();
      extensionTarget = list.find((target) => target.url?.includes(loaded.id) && /options\/options\.html|service-worker\.js/.test(target.url));
      if (extensionTarget) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert(extensionTarget, "Filler did not start after it was loaded.");
    const targets = await listTargets();
    const form = targets.find((target) => target.type === "page" && target.url.startsWith(formUrl));
    const extensionId = new URL(extensionTarget.url).host;
    const optionsUrl = `chrome-extension://${extensionId}/options/options.html`;
    let optionsTarget = targets.find((target) => target.url.startsWith(optionsUrl));
    if (!optionsTarget) {
      await browser.cdp.send("Target.createTarget", { url: optionsUrl });
      const started = Date.now();
      while (Date.now() - started < 10000) {
        const list = await listTargets();
        optionsTarget = list.find((target) => target.url.startsWith(optionsUrl));
        if (optionsTarget) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    assert(optionsTarget, "Options page did not open.");
    const options = await connect(optionsTarget.webSocketDebuggerUrl);
    const formPage = await connect(form.webSocketDebuggerUrl);
    await formPage.cdp.send("Page.enable");
    const name = await evaluate(options.cdp, "chrome.runtime.getManifest().name");
    assert(name === "Filler", `Opened ${name || "an unknown extension"} instead of Filler.`);

    const trace = await evaluate(options.cdp, `(async () => {
      await chrome.storage.local.set({
        provider: "openai",
        apiKey: "test-key",
        model: "mock-model",
        baseUrl: "http://127.0.0.1:${mockPort}/v1",
        profile: "Ada Lovelace, ada@example.com, authorized to work in the United Kingdom, no sponsorship.",
        autoAdvance: true,
        maxSteps: 3
      });
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => (item.url || "").startsWith("http://127.0.0.1:8765/demo/"));
      if (!tab) return JSON.stringify({ error: "Form tab not found", tabs: tabs.map((item) => item.url) });
      const messages = [];
      await new Promise((resolve) => {
        const port = chrome.runtime.connect({ name: "filler" });
        let filled = false;
        const timer = setTimeout(() => resolve(), 40000);
        port.onMessage.addListener((message) => {
          messages.push(message);
          if (message.type === "ERROR") {
            clearTimeout(timer);
            resolve();
          }
          if (!filled && message.type === "DONE" && message.mode === "FILL") {
            filled = true;
            port.postMessage({ type: "SUMMARIZE", tabId: tab.id });
          }
          if (message.type === "DONE" && message.mode === "SUMMARIZE") {
            clearTimeout(timer);
            resolve();
          }
        });
        port.postMessage({ type: "FILL", tabId: tab.id, autoAdvance: true });
      });
      return JSON.stringify(messages, null, 2);
    })()`);
    console.log(trace);

    const report = await evaluate(formPage.cdp, `(() => {
      const value = (id) => document.getElementById(id)?.value ?? null;
      const log = document.querySelector("#log").textContent;
      return {
        first: value("first"),
        last: value("last"),
        email: value("email"),
        phone: value("phone"),
        degree: value("degree"),
        authYes: document.querySelector("input[value='yes']").checked,
        authNo: document.querySelector("input[value='no']").checked,
        sponsor: document.getElementById("sponsor").checked,
        source: document.getElementById("source").textContent.trim(),
        why: value("why"),
        city: value("city"),
        site: value("site"),
        step2Hidden: document.getElementById("step-2").hidden,
        password: document.querySelector("input[type='password']").value,
        honeypot: document.querySelector("input[name='company_website']").value,
        resume: document.getElementById("resume").files.length,
        log
      };
    })()`);
    console.log(JSON.stringify(report, null, 2));

    assert(report.first === "Ada", "First name was not filled.");
    assert(report.last === "Lovelace", "Last name was not filled.");
    assert(report.email === "ada@example.com", "Email was not filled.");
    assert(report.phone === "+1 415 555 0130", "Phone was not filled.");
    assert(report.degree === "ba", "Degree select was not filled.");
    assert(report.authYes === true && report.authNo === false, "Work authorization was not selected.");
    assert(report.sponsor === false, "Sponsorship checkbox was checked.");
    assert(report.source === "Company website", "Custom dropdown was not selected.");
    assert(report.why.includes("calculation tools"), "Why this role was not filled.");
    assert(report.step2Hidden === false, "Next did not open step 2.");
    assert(report.city === "London", "City was not filled on step 2.");
    assert(report.site === "https://ada.example", "Website was not filled on step 2.");
    assert(report.password === "", "Password field was filled.");
    assert(report.honeypot === "", "Honeypot field was filled.");
    assert(report.resume === 0, "File input was filled.");
    assert(report.log.includes("email input ada@example.com"), "Email input event did not fire.");
    assert(!report.log.includes("submit pressed"), "Submit was clicked.");
    assert(trace.includes("Analytical Engineer"), "Page summary was not returned.");

    const shot = await formPage.cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
    browser.ws.close();
    options.ws.close();
    formPage.ws.close();
    console.log("LIVE TEST PASSED");
  } catch (error) {
    failed = error;
  } finally {
    chrome.kill("SIGKILL");
    mock.close();
  }
  if (failed) {
    console.error(failed);
    process.exit(1);
  }
}

await main();
