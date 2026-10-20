import assert from "node:assert/strict";
import test from "node:test";
import { parseModelJson } from "../background/parse-json.js";
import { constrainFills, fitToLength, normalizeSummary, sanitizeFills } from "../background/normalize.js";
import { fillMessages, summaryMessages, toPromptFields } from "../background/prompts.js";
import { customOriginPattern, keyHint } from "../shared/defaults.js";

test("parses fenced, prose-wrapped, and bare JSON", () => {
  assert.deepEqual(parseModelJson('```json\n{"fills":[]}\n```'), { fills: [] });
  assert.deepEqual(parseModelJson('Here you go {"ok":true} thanks'), { ok: true });
  assert.deepEqual(parseModelJson('[{"fieldId":"email","value":"a@b.co"}]'), [
    { fieldId: "email", value: "a@b.co" }
  ]);
});

test("rejects an empty model response", () => {
  assert.throws(() => parseModelJson("   "), /empty/i);
});

test("keeps known answers, including false, and drops invented fields", () => {
  const allowed = new Set(["0:email", "0:sponsor"]);
  const sanitized = sanitizeFills({
    fills: [
      { fieldId: "0:email", value: "ada@example.com" },
      { fieldId: "0:sponsor", value: false },
      { fieldId: "0:password", value: "secret" },
      { fieldId: "0:email", value: "second" },
      { fieldId: "0:note", value: "   " }
    ],
    note: "Left salary blank."
  }, allowed);
  assert.deepEqual(sanitized.fills, [
    { fieldId: "0:email", value: "ada@example.com" },
    { fieldId: "0:sponsor", value: false }
  ]);
  assert.match(sanitized.note, /salary/);
});

test("accepts a bare answer array", () => {
  const sanitized = sanitizeFills([{ fieldId: "1:name", value: "Ada" }], new Set(["1:name"]));
  assert.equal(sanitized.fills[0].value, "Ada");
});

test("asks for exact ids and treats long option lists as searchable", () => {
  const options = Array.from({ length: 30 }, (_, index) => `Option ${index}`);
  const [promptField] = toPromptFields([{
    fieldId: "0:f1",
    kind: "select",
    label: "Country",
    required: true,
    options
  }]);
  assert.equal(promptField.fieldId, "0:f1");
  assert.equal(promptField.searchable, true);
  assert.equal(promptField.options, undefined);
  assert.equal(promptField.optionsSample.length, 12);

  const messages = fillMessages({
    profile: "Email: ada@example.com",
    fields: [{ fieldId: "0:f1", kind: "text", label: "Email", options: [] }],
    title: "Role",
    url: "https://jobs.example.com",
    lang: "en",
    today: "2026-10-19"
  });
  assert.match(messages.system, /untrusted/i);
  assert.match(messages.system, /"fills"/);
  assert.match(messages.system, /thinking/);
  assert.match(messages.system, /maxLength/);
  assert.match(messages.user, /0:f1/);
  assert.match(messages.user, /ada@example.com/);

  const [limited] = toPromptFields([{
    fieldId: "0:why",
    kind: "textarea",
    label: "What was the most challenging problem you solved technically?",
    maxLength: 80,
    minLength: 20,
    error: "Use 80 characters or fewer."
  }]);
  assert.equal(limited.maxLength, 80);
  assert.equal(limited.minLength, 20);
  assert.match(limited.error, /80 characters/);

  const repair = fillMessages({
    profile: "Built a parser at Analytical Engines.",
    fields: [limited],
    title: "Role",
    url: "https://jobs.example.com",
    lang: "en",
    today: "2026-10-20",
    repair: true
  });
  assert.match(repair.user, /rejected these fields/i);
  assert.match(repair.user, /80 characters/);
});

test("shortens an open answer to the field's character limit", () => {
  const long = "I rebuilt the parser after it dropped nested expressions. Then I documented the grammar for the rest of the team and kept going well past the limit.";
  assert.equal(fitToLength(long, 80).length <= 80, true);
  assert.match(fitToLength(long, 80), /expressions\.$/);
  const constrained = constrainFills({
    fills: [{ fieldId: "0:why", value: long }],
    note: "",
    thinking: ""
  }, [{ fieldId: "0:why", maxLength: 80 }]);
  assert.equal(constrained.fills[0].value.length <= 80, true);
  assert.match(constrained.fills[0].value, /parser/);
});

test("summary prompt leaves fit empty without a profile", () => {
  const messages = summaryMessages({
    profile: "",
    title: "Role",
    url: "https://jobs.example.com",
    text: "We are hiring an engineer in London."
  });
  assert.match(messages.user, /empty fit array/i);
  const summary = normalizeSummary({
    summary: "Hiring an engineer.",
    highlights: ["London"],
    role: "Engineer",
    fit: ["Knows maths", "Extra", "Extra", "Extra", "Extra", "Extra", "Extra"]
  });
  assert.equal(summary.highlights[0], "London");
  assert.equal(summary.fit.length, 6);
});

test("custom API origins are explicit and local-only for http", () => {
  assert.equal(customOriginPattern("", "openai"), null);
  assert.equal(customOriginPattern("https://api.openai.com/v1", "openai"), null);
  assert.equal(customOriginPattern("https://api.x.ai/v1", "grok"), null);
  assert.equal(customOriginPattern("https://us.api.x.ai/v1", "grok"), "https://us.api.x.ai/*");
  assert.match(keyHint("grok", "sk-test"), /xai-/);
  assert.equal(keyHint("grok", "xai-test"), "");
  assert.equal(customOriginPattern("https://openrouter.ai/api/v1", "openai"), "https://openrouter.ai/*");
  assert.equal(customOriginPattern("http://127.0.0.1:11434/v1", "openai"), "http://127.0.0.1:11434/*");
  assert.throws(() => customOriginPattern("http://example.com", "openai"), /https/i);
  assert.throws(() => customOriginPattern("https://user:pass@example.com", "openai"), /credential/i);
});
