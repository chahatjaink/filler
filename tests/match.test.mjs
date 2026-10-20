import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadMatch() {
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "content/match.js"), "utf8"), context, { filename: "match.js" });
  return context.FillerMatch || context.globalThis.FillerMatch;
}

const { bestTextMatch, scoreText } = loadMatch();

test("matches exact labels and country aliases", () => {
  assert.equal(scoreText("United States", "United States"), 100);
  assert.ok(scoreText("USA", "United States") >= 90);
  assert.ok(scoreText("U.K.", "United Kingdom") >= 90);
});

test("does not confuse nearby words", () => {
  assert.equal(scoreText("java", "javascript"), 0);
  assert.equal(scoreText("male", "female"), 0);
  assert.equal(scoreText("no", "not sure"), 0);
  assert.equal(bestTextMatch("java", [{ text: "JavaScript" }, { text: "Java" }]).item.text, "Java");
});

test("accepts a longer yes option and rejects a weak overlap", () => {
  assert.ok(scoreText("yes", "Yes, I am authorized to work") >= 80);
  assert.equal(bestTextMatch("it", [{ text: "IT Support" }]), null);
});
