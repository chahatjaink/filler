import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadPage(html) {
  const dom = new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`, {
    url: "https://jobs.example.com/apply",
    pretendToBeVisual: true,
    runScripts: "dangerously"
  });
  const { window } = dom;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, width: 140, height: 28, top: 0, left: 0, right: 140, bottom: 28,
    toJSON() { return {}; }
  });
  for (const file of ["content/dom.js", "content/match.js", "content/extract.js", "content/fill.js"]) {
    const script = window.document.createElement("script");
    script.textContent = fs.readFileSync(path.join(root, file), "utf8");
    window.document.body.appendChild(script);
  }
  return window;
}

const FIXTURE = `
  <form id="apply">
    <div class="field">
      <label for="email">Email *</label>
      <input id="email" name="email" type="email" autocomplete="email" required>
    </div>
    <label for="given">First name</label>
    <input id="given" name="given-name" autocomplete="given-name">
    <fieldset>
      <legend>Work authorization</legend>
      <label><input type="radio" name="auth" value="yes"> Yes</label>
      <label><input type="radio" name="auth" value="no"> No</label>
    </fieldset>
    <label><input id="sponsor" type="checkbox"> Need sponsorship</label>
    <fieldset>
      <legend>Languages</legend>
      <label><input type="checkbox" name="lang" value="js"> JavaScript</label>
      <label><input type="checkbox" name="lang" value="py"> Python</label>
    </fieldset>
    <label for="degree">Degree</label>
    <select id="degree">
      <option value="">Select</option>
      <option value="ba">Bachelor's degree</option>
      <option value="ms">Master's degree</option>
    </select>
    <div data-automation-id="formField-country">
      <label>Country</label>
      <button type="button" id="country" aria-haspopup="listbox" aria-controls="country-list">Select one</button>
      <ul id="country-list" role="listbox" hidden>
        <li role="option">United States</li>
        <li role="option">Canada</li>
      </ul>
    </div>
    <div class="select__control" role="combobox" aria-label="Source">
      <input class="select__input" aria-label="Source search">
    </div>
    <div class="field">
      <label>School</label>
      <select id="school" style="display:none"><option>State University</option></select>
      <div class="select__control" role="combobox" aria-label="School"><input></div>
    </div>
    <label>Resume <input id="resume" type="file"></label>
    <input type="password" name="password" aria-label="Password">
    <label>Leave this field blank <input name="company_website"></label>
    <input name="trap" aria-label="Trap" style="position:absolute;left:-9999px">
    <div hidden>
      <label for="city">City</label>
      <input id="city" name="city">
    </div>
    <button type="button" id="next">Next</button>
    <button type="submit">Submit application</button>
  </form>
  <div id="host"></div>
`;

function field(fields, predicate) {
  const found = fields.find(predicate);
  assert.ok(found, "expected a matching field");
  return found;
}

test("scans native fields, ATS widgets, and skips traps", () => {
  const window = loadPage(FIXTURE);
  const host = window.document.getElementById("host");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = "<label>City <input name=\"city\"></label>";

  const { fields, manual } = window.FillerExtract.extractForm();
  const labels = fields.map((item) => item.label);

  const email = field(fields, (item) => item.autocomplete === "email");
  assert.equal(email.kind, "text");
  assert.equal(email.required, true);
  assert.match(email.label, /Email/);

  const auth = field(fields, (item) => item.kind === "radio-group");
  assert.match(auth.label, /Work authorization/);
  assert.deepEqual([...auth.options], ["Yes", "No"]);

  const languages = field(fields, (item) => item.kind === "checkbox-group");
  assert.deepEqual([...languages.options], ["JavaScript", "Python"]);

  const degree = field(fields, (item) => item.kind === "select");
  assert.deepEqual([...degree.options], ["Bachelor's degree", "Master's degree"]);

  const country = field(fields, (item) => item.label === "Country");
  assert.equal(country.kind, "custom-select");
  assert.ok(country.options.includes("United States"));

  assert.equal(fields.filter((item) => item.label === "Source").length, 1);
  assert.equal(fields.filter((item) => /search/i.test(item.label)).length, 0);
  assert.equal(fields.filter((item) => item.label === "School").length, 1);
  assert.equal(fields.find((item) => item.label === "School").kind, "custom-select");
  assert.equal(fields.filter((item) => item.label === "City").length, 1);

  assert.equal(labels.includes("Password"), false);
  assert.equal(labels.some((label) => /leave this field blank|trap|resume/i.test(label)), false);
  assert.equal(manual.length, 1);
  assert.match(manual[0].reason, /file/i);
});

test("writes values, fires React events, and will not press Submit", async () => {
  const window = loadPage(FIXTURE);
  const { fields } = window.FillerExtract.extractForm();
  const { document } = window;

  const email = field(fields, (item) => item.autocomplete === "email");
  const input = document.getElementById("email");
  const tracker = [];
  const events = [];
  input._valueTracker = { setValue(value) { tracker.push(value); } };
  for (const type of ["input", "change", "blur"]) {
    input.addEventListener(type, () => events.push(type));
  }
  await window.FillerFill.applyFills([{ localId: email.localId, value: "ada@example.com" }]);
  assert.equal(input.value, "ada@example.com");
  assert.ok(tracker.length >= 1);
  assert.deepEqual(events, ["input", "change", "blur"]);

  const degree = field(fields, (item) => item.kind === "select");
  await window.FillerFill.applyFills([{ localId: degree.localId, value: "Bachelor's degree" }]);
  assert.equal(document.getElementById("degree").value, "ba");

  const sponsor = field(fields, (item) => item.kind === "checkbox" && /sponsorship/i.test(item.label));
  await window.FillerFill.applyFills([{ localId: sponsor.localId, value: true }]);
  assert.equal(document.getElementById("sponsor").checked, true);

  const languages = field(fields, (item) => item.kind === "checkbox-group");
  await window.FillerFill.applyFills([{ localId: languages.localId, value: ["JavaScript"] }]);
  assert.equal(document.querySelector("input[value='js']").checked, true);
  assert.equal(document.querySelector("input[value='py']").checked, false);

  const auth = field(fields, (item) => item.kind === "radio-group");
  await window.FillerFill.applyFills([{ localId: auth.localId, value: "Yes" }]);
  assert.equal(document.querySelector("input[value='yes']").checked, true);
  assert.equal(document.querySelector("input[value='no']").checked, false);
  await window.FillerFill.applyFills([{ localId: auth.localId, value: "No" }]);
  assert.equal(document.querySelector("input[value='no']").checked, true);
  assert.equal(document.querySelector("input[value='yes']").checked, false);
  await window.FillerFill.applyFills([{ localId: sponsor.localId, value: false }]);
  assert.equal(document.getElementById("sponsor").checked, false);

  const country = field(fields, (item) => item.label === "Country");
  const button = document.getElementById("country");
  button.addEventListener("click", () => {
    document.getElementById("country-list").hidden = false;
  });
  document.getElementById("country-list").addEventListener("click", (event) => {
    const option = event.target.closest("[role='option']");
    if (option) button.textContent = option.textContent;
  });
  await window.FillerFill.applyFills([{ localId: country.localId, value: "United States" }]);
  assert.match(button.textContent, /United States/);

  let pressed = "";
  document.getElementById("next").addEventListener("click", () => { pressed = "next"; });
  document.querySelector("button[type='submit']").addEventListener("click", () => { pressed = "submit"; });
  const moved = window.FillerFill.clickNext();
  assert.equal(moved.clicked, true);
  assert.equal(pressed, "next");
});

test("records a length limit and a visible validation error", () => {
  const window = loadPage(`
    <div class="field">
      <label for="challenge">Most challenging problem</label>
      <textarea id="challenge" maxlength="80" minlength="20" aria-invalid="true" aria-errormessage="challenge-error">A very long draft answer</textarea>
      <p id="challenge-error" role="alert">Use 80 characters or fewer.</p>
    </div>
  `);
  const { fields } = window.FillerExtract.extractForm();
  const challenge = field(fields, (item) => item.label === "Most challenging problem");
  assert.equal(challenge.maxLength, 80);
  assert.equal(challenge.minLength, 20);
  assert.match(challenge.error, /80 characters/);
  assert.match(challenge.currentValue, /long draft/);
});

test("page text prefers the article and skips the form", () => {
  const window = loadPage(`
    <article><h1>Analytical engineer</h1><p>London. Mathematics required.</p></article>
    <form><label>Email <input name="email"></label></form>
  `);
  const page = window.FillerExtract.extractPageText();
  assert.match(page.text, /Mathematics required/);
  assert.doesNotMatch(page.text, /Email/);
});
