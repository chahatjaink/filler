(() => {
  "use strict";

  const ALIAS_GROUPS = [
    ["usa", "us", "united states", "united states of america"],
    ["uk", "u k", "united kingdom", "great britain"],
    ["uae", "united arab emirates"]
  ];

  function normalizeText(value) {
    return String(value ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9+#]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function includesToken(hay, needle) {
    if (!needle || needle.length < 4) return false;
    const index = hay.indexOf(needle);
    if (index < 0) return false;
    const before = hay[index - 1];
    const after = hay[index + needle.length];
    return (index === 0 || before === " ") && (after == null || after === " ");
  }

  function aliasScore(a, b) {
    for (const group of ALIAS_GROUPS) {
      if (group.includes(a) && group.includes(b)) return 97;
    }
    return 0;
  }

  function scoreText(wanted, candidate) {
    const a = normalizeText(wanted);
    const b = normalizeText(candidate);
    if (!a || !b) return 0;
    if (a === b) return 100;
    const alias = aliasScore(a, b);
    if (alias) return alias;
    if ((a === "yes" || a === "no") && (b.startsWith(`${a} `) || b.startsWith(`${a},`) || b.startsWith(`${a}/`))) {
      return 88;
    }
    if (a.length >= 4 && (b.startsWith(`${a} `) || b.startsWith(`${a},`) || b.startsWith(`${a} (`))) return 86;
    if (includesToken(b, a) || includesToken(a, b)) {
      const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
      return 70 + Math.round(ratio * 20);
    }
    const left = new Set(a.split(" ").filter(Boolean));
    const right = new Set(b.split(" ").filter(Boolean));
    let overlap = 0;
    for (const token of left) {
      if (right.has(token) && (token.length > 1 || /\d/.test(token))) overlap += 1;
    }
    if (!overlap) return 0;
    return Math.round((overlap / Math.max(left.size, right.size)) * 64);
  }

  function bestTextMatch(wanted, candidates) {
    let best = null;
    let bestScore = 0;
    const wantedLength = normalizeText(wanted).length;
    for (const candidate of candidates) {
      const texts = [candidate.text, candidate.value, ...(candidate.extraTexts || [])];
      let score = 0;
      for (const text of texts) score = Math.max(score, scoreText(wanted, text));
      if (score < 64) continue;
      const closeness = Math.abs(normalizeText(candidate.text).length - wantedLength);
      const bestCloseness = best ? Math.abs(normalizeText(best.text).length - wantedLength) : Infinity;
      if (score > bestScore || (score === bestScore && closeness < bestCloseness)) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) return null;
    return { item: best, score: bestScore };
  }

  globalThis.FillerMatch = {
    normalizeText,
    scoreText,
    bestTextMatch
  };
})();
