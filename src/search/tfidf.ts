const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'not', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did',
  'doing', 'will', 'would', 'could', 'should', 'shall', 'may', 'might', 'can',
  'must', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between',
  'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here',
  'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'about', 'up', 'down', 'if',
  'it', 'its', 'he', 'she', 'they', 'them', 'his', 'her', 'their', 'we',
  'me', 'him', 'my', 'your', 'our', 'this', 'that', 'these', 'those', 'i',
  'you', 'what', 'which', 'who', 'whom', 'am',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 0 && !STOPWORDS.has(token));
}

interface DocEntry {
  termFreqs: Map<string, number>;
  totalTerms: number;
}

/**
 * Compute a recency decay multiplier using exponential decay.
 * Half-life is in days — after `halfLifeDays`, the multiplier is 0.5.
 * Returns a value in (0, 1] where 1 = now, 0.5 = halfLifeDays ago, etc.
 * Floor of 0.1 ensures very old results aren't completely invisible.
 */
export function recencyDecay(
  timestamp: string | null,
  halfLifeDays: number = 30,
): number {
  if (!timestamp) return 0.5; // unknown age gets neutral weight
  const ageMs = Date.now() - new Date(timestamp).getTime();
  if (ageMs <= 0) return 1.0;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const decay = Math.pow(0.5, ageDays / halfLifeDays);
  return Math.max(decay, 0.1); // floor at 0.1
}

export class TfIdfIndex {
  private docs: Map<string, DocEntry> = new Map();
  private docFreq: Map<string, number> = new Map();
  private totalDocs: number = 0;

  addDocument(id: string, text: string): void {
    if (this.docs.has(id)) {
      const existing = this.docs.get(id)!;
      for (const term of existing.termFreqs.keys()) {
        const count = this.docFreq.get(term) ?? 0;
        if (count <= 1) {
          this.docFreq.delete(term);
        } else {
          this.docFreq.set(term, count - 1);
        }
      }
      this.totalDocs--;
    }

    const tokens = tokenize(text);
    const termFreqs = new Map<string, number>();

    for (const token of tokens) {
      termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
    }

    this.docs.set(id, { termFreqs, totalTerms: tokens.length });

    for (const term of termFreqs.keys()) {
      this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }

    this.totalDocs++;
  }

  search(query: string, maxResults?: number): Array<{ id: string; score: number }> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.totalDocs === 0) {
      return [];
    }

    const results: Array<{ id: string; score: number }> = [];

    for (const [id, doc] of this.docs) {
      let score = 0;

      for (const term of queryTokens) {
        const termCount = doc.termFreqs.get(term) ?? 0;
        if (termCount === 0) continue;

        const tf = termCount / doc.totalTerms;
        const docsWithTerm = this.docFreq.get(term) ?? 0;
        const idf = Math.log(1 + this.totalDocs / docsWithTerm);

        score += tf * idf;
      }

      if (score > 0) {
        results.push({ id, score });
      }
    }

    results.sort((a, b) => b.score - a.score);

    if (maxResults !== undefined && maxResults > 0) {
      return results.slice(0, maxResults);
    }

    return results;
  }

  clear(): void {
    this.docs.clear();
    this.docFreq.clear();
    this.totalDocs = 0;
  }
}
