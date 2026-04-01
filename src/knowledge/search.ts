import { TfIdfIndex } from '../search/tfidf.js';
import { getEntryScoring, computeFinalScore } from './scoring.js';
import { buildExcerpt } from '../search/excerpt.js';
import { listEntries, readEntry, KnowledgeEntry } from './store.js';

export interface SearchOptions {
  category?: string;
  maxResults?: number;
  caseSensitive?: boolean;
}

export interface SearchResult {
  entry: KnowledgeEntry;
  score: number;
  excerpt: string;
}

// ── TF-IDF index cache for knowledge entries ──────────────────────────────

interface KnowledgeIndexCache {
  index: TfIdfIndex;
  documents: Array<{ entry: KnowledgeEntry; content: string }>;
  timestamp: number;
  /** Cache key: dir + category */
  cacheKey: string;
}

let _knowledgeIndexCache: KnowledgeIndexCache | null = null;
const KNOWLEDGE_INDEX_TTL = 60_000; // 60 seconds, matching session search cache

/** Invalidate the knowledge TF-IDF index cache (call on write/delete). */
export function invalidateKnowledgeIndexCache(): void {
  _knowledgeIndexCache = null;
}

function getOrBuildKnowledgeIndex(
  dir: string,
  category?: string,
): { index: TfIdfIndex; documents: Array<{ entry: KnowledgeEntry; content: string }> } {
  const cacheKey = `${dir}:${category ?? ''}`;
  const now = Date.now();

  if (
    _knowledgeIndexCache &&
    now - _knowledgeIndexCache.timestamp < KNOWLEDGE_INDEX_TTL &&
    _knowledgeIndexCache.cacheKey === cacheKey
  ) {
    return _knowledgeIndexCache;
  }

  const entries = listEntries(dir, category);
  const documents: Array<{ entry: KnowledgeEntry; content: string }> = [];

  for (const entry of entries) {
    try {
      const { content } = readEntry(dir, entry.path);
      documents.push({ entry: { ...entry, content }, content });
    } catch {
      continue;
    }
  }

  const index = new TfIdfIndex();
  for (const doc of documents) {
    index.addDocument(doc.entry.path, doc.content);
  }

  _knowledgeIndexCache = { index, documents, timestamp: now, cacheKey };
  return { index, documents };
}

/**
 * Search knowledge entries using TF-IDF ranking with regex fallback.
 *
 * Uses a cached TF-IDF index (60s TTL, invalidated on write/delete) to
 * avoid rebuilding the index on every search. Falls back to regex search
 * if TF-IDF returns no results (useful for exact phrase matches).
 */
export function searchKnowledge(
  dir: string,
  query: string,
  options: SearchOptions = {},
): Array<SearchResult> {
  const { category, maxResults = 10, caseSensitive = false } = options;

  const { index, documents } = getOrBuildKnowledgeIndex(dir, category);

  if (documents.length === 0) return [];

  // Search using TF-IDF
  const tfidfResults = index.search(query, maxResults);

  if (tfidfResults.length > 0) {
    const results: SearchResult[] = [];
    const scoring = getEntryScoring();
    const entryPaths = tfidfResults
      .map((r) => documents.find((d) => d.entry.path === r.id)?.entry.path)
      .filter((p): p is string => p !== undefined);
    const scores = scoring.getScores(entryPaths);

    for (const result of tfidfResults) {
      const doc = documents.find((d) => d.entry.path === result.id);
      if (!doc) continue;

      const scoreInfo = scores.get(doc.entry.path);
      const maturity = (scoreInfo?.maturity ?? 'candidate') as
        | 'candidate'
        | 'established'
        | 'proven';
      const lastAccessed = scoreInfo?.last_accessed ?? null;
      const finalScore = computeFinalScore(result.score, lastAccessed, maturity);

      results.push({
        entry: doc.entry,
        score: finalScore,
        excerpt: buildExcerpt(doc.content, query, { caseSensitive, contextAfter: 200 }),
      });
    }

    // Filter out negative scores and re-sort by final score
    const filtered = results.filter((r) => r.score > 0);
    filtered.sort((a, b) => b.score - a.score);
    return filtered;
  }

  // Fallback: regex search for exact phrase matches
  const flags = caseSensitive ? 'g' : 'gi';
  let regex: RegExp;
  try {
    regex = new RegExp(query, flags);
  } catch {
    regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  }

  const regexResults: SearchResult[] = [];
  for (const doc of documents) {
    regex.lastIndex = 0; // Reset before test() — global regex is stateful
    if (regex.test(doc.content)) {
      regexResults.push({
        entry: doc.entry,
        score: 1,
        excerpt: buildExcerpt(doc.content, query, { caseSensitive, contextAfter: 200 }),
      });
      if (regexResults.length >= maxResults) break;
    }
  }

  return regexResults;
}
