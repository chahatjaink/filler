import {
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  STORAGE_DEFAULTS,
  clampSteps,
  customOriginPattern,
  keyHint
} from "../shared/defaults.js";

const form = document.querySelector("#settings");
const keyInput = document.querySelector("#api-key");
const modelInput = document.querySelector("#model");
const baseInput = document.querySelector("#base-url");
const profileInput = document.querySelector("#profile");
const advanceInput = document.querySelector("#advance");
const stepsInput = document.querySelector("#steps");
const feedback = document.querySelector("#feedback");
const keyHintNode = document.querySelector("#key-hint");
const countNode = document.querySelector("#count");
const keyLink = document.querySelector("#key-link");
const testButton = document.querySelector("#test");
const toggleKey = document.querySelector("#toggle-key");

const KEY_LINKS = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  gemini: "https://aistudio.google.com/apikey",
  grok: "https://console.x.ai/"
};

function provider() {
  return form.querySelector("input[name='provider']:checked")?.value || "openai";
}

function setProvider(value) {
  const input = form.querySelector(`input[name='provider'][value='${value}']`);
  if (input) input.checked = true;
  modelInput.placeholder = DEFAULT_MODELS[value] || "";
  baseInput.placeholder = DEFAULT_BASE_URLS[value] || "";
  keyLink.href = KEY_LINKS[value] || KEY_LINKS.openai;
  keyHintNode.textContent = keyHint(value, keyInput.value);
}

function readForm() {
  return {
    provider: provider(),
    apiKey: keyInput.value.trim(),
    model: modelInput.value.trim(),
    baseUrl: baseInput.value.trim(),
    profile: profileInput.value,
    autoAdvance: advanceInput.checked,
    maxSteps: clampSteps(stepsInput.value)
  };
}

function showFeedback(message, kind) {
  feedback.textContent = message || "";
  feedback.className = kind || "";
}

function updateCount() {
  const length = profileInput.value.trim().length;
  const limit = length > 24000 ? " — only the first 24,000 characters are sent" : "";
  countNode.textContent = `${length.toLocaleString()} characters${limit}`;
}

function originFor(settings) {
  return customOriginPattern(settings.baseUrl, settings.provider);
}

function grant(settings, done) {
  let origin = null;
  try {
    origin = originFor(settings);
  } catch (error) {
    showFeedback(error.message, "bad");
    return;
  }
  if (!origin) {
    done();
    return;
  }
  chrome.permissions.request({ origins: [origin] }, (granted) => {
    if (!granted) {
      showFeedback("Allow the API host so Filler can call it.", "bad");
      return;
    }
    done();
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const settings = readForm();
  if (settings.profile.length > 200000) {
    showFeedback("That background is too large to store. Keep it under 200,000 characters.", "bad");
    return;
  }
  grant(settings, () => {
    chrome.storage.local.set(settings, () => {
      if (chrome.runtime.lastError) {
        showFeedback(chrome.runtime.lastError.message, "bad");
        return;
      }
      showFeedback("Saved on this device.", "ok");
    });
  });
});

testButton.addEventListener("click", () => {
  const settings = readForm();
  if (!settings.apiKey) {
    showFeedback("Enter an API key first.", "bad");
    return;
  }
  grant(settings, () => {
    testButton.disabled = true;
    showFeedback("Contacting the model…");
    chrome.runtime.sendMessage({ type: "TEST_CONNECTION", settings }, (response) => {
      testButton.disabled = false;
      if (chrome.runtime.lastError) {
        showFeedback(chrome.runtime.lastError.message, "bad");
        return;
      }
      if (response?.ok) showFeedback(`Connected to ${response.model}.`, "ok");
      else showFeedback(response?.error || "The test failed.", "bad");
    });
  });
});

toggleKey.addEventListener("click", () => {
  const hidden = keyInput.type === "password";
  keyInput.type = hidden ? "text" : "password";
  toggleKey.textContent = hidden ? "Hide" : "Show";
});

keyInput.addEventListener("input", () => {
  keyHintNode.textContent = keyHint(provider(), keyInput.value);
});

profileInput.addEventListener("input", updateCount);
form.querySelectorAll("input[name='provider']").forEach((input) => {
  input.addEventListener("change", () => setProvider(provider()));
});

chrome.storage.local.get(STORAGE_DEFAULTS, (stored) => {
  setProvider(stored.provider || "openai");
  keyInput.value = stored.apiKey || "";
  modelInput.value = stored.model || "";
  baseInput.value = stored.baseUrl || "";
  profileInput.value = stored.profile || "";
  advanceInput.checked = Boolean(stored.autoAdvance);
  stepsInput.value = String(clampSteps(stored.maxSteps));
  keyHintNode.textContent = keyHint(provider(), keyInput.value);
  updateCount();
});
