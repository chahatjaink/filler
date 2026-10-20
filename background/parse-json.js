export function parseModelJson(text) {
  if (text == null) throw new Error("The model returned an empty response.");
  const raw = String(text).trim();
  if (!raw) throw new Error("The model returned an empty response.");

  const candidates = [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(raw);

  const spans = [];
  const objStart = raw.indexOf("{");
  const objEnd = raw.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) spans.push({ start: objStart, text: raw.slice(objStart, objEnd + 1) });
  const arrStart = raw.indexOf("[");
  const arrEnd = raw.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) spans.push({ start: arrStart, text: raw.slice(arrStart, arrEnd + 1) });
  spans.sort((a, b) => a.start - b.start);
  for (const span of spans) candidates.push(span.text);

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`The model did not return valid JSON. ${lastError?.message || ""}`.trim());
}
