export function levenshtein(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;

  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  let prev = new Array<number>(bLen + 1);
  let curr = new Array<number>(bLen + 1);

  for (let j = 0; j <= bLen; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= aLen; i++) {
    curr[0] = i;

    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }

    [prev, curr] = [curr, prev];
  }

  return prev[bLen];
}

export function fuzzyMatch(
  needle: string,
  haystack: string,
  threshold: number = 0.7
): Array<{ start: number; end: number; score: number }> {
  const results: Array<{ start: number; end: number; score: number }> = [];

  if (needle.length === 0 || haystack.length === 0) {
    return results;
  }

  const needleLower = needle.toLowerCase();
  const haystackLower = haystack.toLowerCase();
  const needleLen = needleLower.length;

  const minWindow = Math.max(1, Math.floor(needleLen * threshold));
  const maxWindow = Math.ceil(needleLen / threshold);

  const bestAtPos = new Map<number, { end: number; score: number }>();

  for (let winSize = minWindow; winSize <= Math.min(maxWindow, haystackLower.length); winSize++) {
    for (let start = 0; start <= haystackLower.length - winSize; start++) {
      const window = haystackLower.substring(start, start + winSize);
      const distance = levenshtein(needleLower, window);
      const maxLen = Math.max(needleLen, winSize);
      const score = 1 - distance / maxLen;

      if (score >= threshold) {
        const existing = bestAtPos.get(start);
        if (!existing || score > existing.score) {
          bestAtPos.set(start, { end: start + winSize, score });
        }
      }
    }
  }

  const candidates = Array.from(bestAtPos.entries())
    .map(([start, { end, score }]) => ({ start, end, score }))
    .sort((a, b) => b.score - a.score);

  const taken: Array<{ start: number; end: number; score: number }> = [];

  for (const candidate of candidates) {
    const overlaps = taken.some(
      t => candidate.start < t.end && candidate.end > t.start
    );
    if (!overlaps) {
      taken.push(candidate);
    }
  }

  taken.sort((a, b) => a.start - b.start);

  return taken;
}

export function fuzzySearch(
  query: string,
  texts: Array<{ id: string; text: string }>,
  threshold: number = 0.7
): Array<{ id: string; score: number; excerpt: string }> {
  const results: Array<{ id: string; score: number; excerpt: string }> = [];

  for (const { id, text } of texts) {
    const matches = fuzzyMatch(query, text, threshold);
    if (matches.length === 0) continue;

    const bestMatch = matches.reduce(
      (best, m) => (m.score > best.score ? m : best),
      matches[0]
    );

    const contextChars = 40;
    const excerptStart = Math.max(0, bestMatch.start - contextChars);
    const excerptEnd = Math.min(text.length, bestMatch.end + contextChars);

    let excerpt = text.substring(excerptStart, excerptEnd);
    if (excerptStart > 0) excerpt = '...' + excerpt;
    if (excerptEnd < text.length) excerpt = excerpt + '...';

    results.push({ id, score: bestMatch.score, excerpt });
  }

  results.sort((a, b) => b.score - a.score);

  return results;
}
