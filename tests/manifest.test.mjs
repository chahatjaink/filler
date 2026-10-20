import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("manifest points at files that exist", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons)
  ];
  for (const file of files) {
    assert.equal(fs.existsSync(path.join(root, file)), true, file);
  }
  assert.ok(manifest.host_permissions.includes("https://api.openai.com/*"));
  assert.ok(manifest.host_permissions.includes("https://api.x.ai/*"));
  assert.equal(manifest.content_scripts, undefined);
});
