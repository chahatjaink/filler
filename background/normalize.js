import { LIMITS } from "../shared/defaults.js";

function clipText(value, max) {
  const clean = String(value || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function asList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => clipText(item, 240))
    .filter(Boolean);
}

export function coerceFillList(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.fills)) return parsed.fills;
  if (Array.isArray(parsed?.fields)) return parsed.fields;
  if (Array.isArray(parsed?.answers)) return parsed.answers;
  return [];
}

function cleanValue(value) {
  if (value == null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    return text.length > LIMITS.maxValueChars ? text.slice(0, LIMITS.maxValueChars) : text;
  }
  if (Array.isArray(value)) {
    const items = value
      .filter((item) => ["string", "number", "boolean"].includes(typeof item))
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((item) => (item.length > 300 ? item.slice(0, 300) : item));
    return items.length ? items : null;
  }
  return null;
}

export function sanitizeFills(parsed, allowedIds) {
  const fills = [];
  const seen = new Set();
  for (const item of coerceFillList(parsed)) {
    if (!item || typeof item !== "object") continue;
    const fieldId = String(item.fieldId || item.id || "").trim();
    if (!fieldId || !allowedIds.has(fieldId) || seen.has(fieldId)) continue;
    const value = cleanValue(item.value);
    if (value == null) continue;
    seen.add(fieldId);
    fills.push({ fieldId, value });
  }
  const note = !parsed || Array.isArray(parsed) ? "" : clipText(parsed.note || parsed.notes || "", 320);
  const thinking = !parsed || Array.isArray(parsed) || typeof parsed.thinking !== "string"
    ? ""
    : clipText(parsed.thinking, 600);
  return { fills, note, thinking };
}

export function fitToLength(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!max || text.length <= max) return text;
  const slice = text.slice(0, max).trimEnd();
  const sentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (sentenceEnd >= Math.min(24, Math.floor(max * 0.4))) return slice.slice(0, sentenceEnd + 1).trim();
  const word = slice.replace(/\s+\S*$/, "").trim();
  if (word.length >= Math.min(8, max)) return word;
  return slice;
}

export function constrainFills(result, fields) {
  const limits = new Map((fields || []).map((field) => [field.fieldId, Number(field.maxLength) || 0]));
  const fills = [];
  for (const fill of result?.fills || []) {
    const max = limits.get(fill.fieldId) || 0;
    if (!max || typeof fill.value !== "string" || fill.value.length <= max) {
      fills.push(fill);
      continue;
    }
    const value = fitToLength(fill.value, max);
    if (value) fills.push({ ...fill, value });
  }
  return { ...result, fills };
}

export function normalizeSummary(parsed, fallbackText = "") {
  const source = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const summary = clipText(source.summary || source.text || fallbackText, 2000);
  return {
    summary,
    highlights: asList(source.highlights).slice(0, 8),
    role: clipText(source.role || "", 200),
    location: clipText(source.location || "", 200),
    compensation: clipText(source.compensation || "", 200),
    fit: asList(source.fit).slice(0, 6)
  };
}
