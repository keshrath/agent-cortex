import { TfIdfIndex } from '../search/tfidf.js';
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

/**
 * Extract an excerpt around the first match of a query in the text.
 * Shows ~100 chars before the match and ~200 chars after.
 */
function extractExcerpt(text: string, query: string, caseSensitive: boolean): string {
  const flags = caseSensitive ? 'g' : 'gi';
  let regex: RegExp;
  try {
    regex = new RegExp(query, flags);
  } catch {
    regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  }

  const match = regex.exec(text);
  if (!match) {
    // No match found — return first 300 chars
    return text.substring(0, 300) + (text.length > 300 ? '...' : '');
  }

  const matchStart = match.index;
  const matchEnd = matchStart + match[0].length;
  const start = Math.max(0, matchStart - 100);
  const end = Math.min(text.length, matchEnd + 200);

  let excerpt = '';
  if (start > 0) excerpt += '...';
  excerpt += text.substring(start, end).trim();
  if (end < text.length) excerpt += '...';

  return excerpt;
}

/**
 * Search knowledge entries using TF-IDF ranking with regex fallback.
 *
 * Builds a TF-IDF index from all entries, searches by query, and returns
 * ranked results with excerpts. Falls back to regex search if TF-IDF
 * returns no results (useful for exact phrase matches).
 */
export function searchKnowledge(
  dir: string,
  query: string,
  options: SearchOptions = {},
): Array<SearchResult> {
  const { category, maxResults = 10, caseSensitive = false } = options;

  // Gather all entries with their content
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

  if (documents.length === 0) return [];

  // Build TF-IDF index
  const index = new TfIdfIndex();
  for (const doc of documents) {
    index.addDocument(doc.entry.path, doc.content);
  }

  // Search using TF-IDF
  const tfidfResults = index.search(query, maxResults);

  if (tfidfResults.length > 0) {
    const results: SearchResult[] = [];
    for (const result of tfidfResults) {
      const doc = documents.find((d) => d.entry.path === result.id);
      if (!doc) continue;

      results.push({
        entry: doc.entry,
        score: result.score,
        excerpt: extractExcerpt(doc.content, query, caseSensitive),
      });
    }
    return results;
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
    if (regex.test(doc.content)) {
      regex.lastIndex = 0; // Reset after test()
      regexResults.push({
        entry: doc.entry,
        score: 1,
        excerpt: extractExcerpt(doc.content, query, caseSensitive),
      });
      if (regexResults.length >= maxResults) break;
    }
  }

  return regexResults;
}
