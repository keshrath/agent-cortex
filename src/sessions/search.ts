import { TfIdfIndex } from '../search/tfidf.js';
import {
  getProjectDirs,
  getSessionFiles,
  parseSessionFile,
  extractMessages,
  getSessionMeta,
} from './parser.js';
import type { SearchResult } from '../search/types.js';

export interface SearchSessionOptions {
  project?: string;
  role?: 'user' | 'assistant' | 'all';
  caseSensitive?: boolean;
  maxResults?: number;
  /** When true (default), use TF-IDF ranking. When false, use regex matching. */
  ranked?: boolean;
}

/**
 * Search across all session transcripts.
 *
 * Supports two modes:
 * - **ranked** (default): builds a TF-IDF index over all messages, returns
 *   results ordered by relevance score.
 * - **legacy** (`ranked: false`): regex-based matching, faster for exact
 *   phrases and pattern searches.
 *
 * Returns results with excerpts (100 chars before + 100 chars after match).
 */
export function searchSessions(
  query: string,
  options: SearchSessionOptions = {},
): SearchResult[] {
  const {
    project,
    role = 'all',
    caseSensitive = false,
    maxResults = 20,
    ranked = true,
  } = options;

  const projects = getProjectDirs().filter(
    p => !project || p.name.toLowerCase().includes(project.toLowerCase()),
  );

  if (ranked) {
    return rankedSearch(query, projects, role, maxResults);
  }

  return regexSearch(query, projects, role, caseSensitive, maxResults);
}

// ── TF-IDF ranked search ────────────────────────────────────────────────────

interface DocRef {
  project: string;
  sessionId: string;
  role: string;
  timestamp: string | null;
  content: string;
  sessionDate: string;
}

function rankedSearch(
  query: string,
  projects: Array<{ name: string; path: string }>,
  role: string,
  maxResults: number,
): SearchResult[] {
  const index = new TfIdfIndex();
  const docMap = new Map<string, DocRef>();
  let docCounter = 0;

  for (const proj of projects) {
    const sessions = getSessionFiles(proj.path);
    for (const sess of sessions) {
      try {
        const entries = parseSessionFile(sess.file);
        if (entries.length === 0) continue;
        const meta = getSessionMeta(entries);
        const messages = extractMessages(entries);

        for (const msg of messages) {
          if (role !== 'all' && msg.role !== role) continue;

          const docId = `doc_${docCounter++}`;
          index.addDocument(docId, msg.content);
          docMap.set(docId, {
            project: proj.name,
            sessionId: sess.id,
            role: msg.role,
            timestamp: msg.timestamp,
            content: msg.content,
            sessionDate: meta.startTime,
          });
        }
      } catch {
        // skip broken files
      }
    }
  }

  const ranked = index.search(query, maxResults);

  return ranked.map(({ id, score }) => {
    const doc = docMap.get(id)!;
    const excerpt = buildExcerpt(doc.content, query);

    return {
      source: 'session' as const,
      id: doc.sessionId,
      project: doc.project,
      role: doc.role,
      timestamp: doc.timestamp ?? doc.sessionDate,
      excerpt,
      score,
      metadata: {
        sessionDate: doc.sessionDate,
      },
    };
  });
}

// ── Regex-based search (legacy mode) ────────────────────────────────────────

function regexSearch(
  query: string,
  projects: Array<{ name: string; path: string }>,
  role: string,
  caseSensitive: boolean,
  maxResults: number,
): SearchResult[] {
  const flags = caseSensitive ? 'g' : 'gi';
  let regex: RegExp;
  try {
    regex = new RegExp(query, flags);
  } catch {
    regex = new RegExp(
      query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      flags,
    );
  }

  const matches: SearchResult[] = [];

  for (const proj of projects) {
    const sessions = getSessionFiles(proj.path);
    for (const sess of sessions) {
      try {
        const entries = parseSessionFile(sess.file);
        if (entries.length === 0) continue;
        const meta = getSessionMeta(entries);
        const messages = extractMessages(entries);

        for (const msg of messages) {
          if (role !== 'all' && msg.role !== role) continue;
          if (!regex.test(msg.content)) continue;

          // Reset lastIndex for stateful regex
          regex.lastIndex = 0;

          const excerpt = buildExcerpt(msg.content, query, caseSensitive);

          matches.push({
            source: 'session',
            id: sess.id,
            project: proj.name,
            role: msg.role,
            timestamp: msg.timestamp ?? meta.startTime,
            excerpt,
            score: 1, // no ranking in regex mode
            metadata: {
              sessionDate: meta.startTime,
            },
          });

          if (matches.length >= maxResults) break;
        }
      } catch {
        // skip
      }
      if (matches.length >= maxResults) break;
    }
    if (matches.length >= maxResults) break;
  }

  return matches;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build an excerpt around the first occurrence of `query` in `text`,
 * with 100 chars of context on each side.
 */
function buildExcerpt(
  text: string,
  query: string,
  caseSensitive = false,
): string {
  let idx: number;
  try {
    idx = text.search(new RegExp(query, caseSensitive ? '' : 'i'));
  } catch {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    idx = text.search(new RegExp(escaped, caseSensitive ? '' : 'i'));
  }

  if (idx === -1) {
    // Fallback: return the beginning of the text
    return text.substring(0, 300) + (text.length > 300 ? '...' : '');
  }

  const start = Math.max(0, idx - 100);
  const end = Math.min(text.length, idx + query.length + 100);

  return (
    (start > 0 ? '...' : '') +
    text.substring(start, end) +
    (end < text.length ? '...' : '')
  );
}
