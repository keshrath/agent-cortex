import {
  getProjectDirs,
  getSessionFiles,
  parseSessionFile,
  extractMessages,
  getSessionMeta,
  type SessionMessage,
} from './parser.js';
import { TfIdfIndex } from '../search/tfidf.js';
import { buildExcerpt } from '../search/excerpt.js';
import type { SearchResult } from '../search/types.js';

// ── Types ───────────────────────────────────────────────────────────────────

export type SearchScope =
  | 'errors'
  | 'plans'
  | 'configs'
  | 'tools'
  | 'files'
  | 'decisions'
  | 'all';

export interface ScopedSearchOptions {
  project?: string;
  maxResults?: number;
}

// ── Scope pattern definitions ───────────────────────────────────────────────

const SCOPE_PATTERNS: Record<Exclude<SearchScope, 'all' | 'tools'>, RegExp> = {
  errors: /\b(error|exception|failed|failure|crash|stack\s*trace|ENOENT|EACCES|EPERM|ECONNREFUSED|TypeError|ReferenceError|SyntaxError|FATAL|panic|segfault|abort|unhandled|rejected)\b/i,
  plans: /\b(plan|step\s+\d|phase|approach|strategy|TODO|FIXME|architecture|roadmap|milestone|objective|next\s+steps|action\s+items)\b/i,
  configs: /\b(config|settings|\.env|\.json|\.yaml|\.yml|\.toml|tsconfig|package\.json|webpack|vite|eslint|prettier|docker|compose|nginx)\b/i,
  files: /(?:src\/|lib\/|dist\/|\.ts\b|\.js\b|\.py\b|\.rs\b|\.go\b|\.java\b|\.vue\b|\.tsx\b|\.jsx\b|\/[\w.-]+\/|created|modified|deleted|renamed|moved)\b/i,
  decisions: /\b(decided|chose|chosen|because|tradeoff|trade-off|instead\s+of|going\s+with|opted\s+for|rationale|reasoning|prefer|alternative|pros\s+and\s+cons|conclusion)\b/i,
};

// ── Scoped search ───────────────────────────────────────────────────────────

/**
 * Perform a search scoped to a specific category of content.
 *
 * Each scope pre-filters messages by role/content patterns, then applies TF-IDF
 * ranking with the user query on the remaining messages.
 */
export function scopedSearch(
  scope: SearchScope,
  query: string,
  options: ScopedSearchOptions = {},
): SearchResult[] {
  const { project, maxResults = 20 } = options;

  const projects = getProjectDirs().filter(
    p => !project || p.name.toLowerCase().includes(project.toLowerCase()),
  );

  const index = new TfIdfIndex();
  const docMap = new Map<
    string,
    {
      project: string;
      sessionId: string;
      role: string;
      timestamp: string | null;
      content: string;
      sessionDate: string;
    }
  >();
  let docCounter = 0;

  for (const proj of projects) {
    const sessions = getSessionFiles(proj.path);
    for (const sess of sessions) {
      try {
        const entries = parseSessionFile(sess.file);
        if (entries.length === 0) continue;
        const meta = getSessionMeta(entries);
        const messages = extractMessages(entries);

        const filtered = filterByScope(scope, messages);

        for (const msg of filtered) {
          const docId = `doc_${docCounter++}`;
          // Index the message content combined with the query context
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

  return ranked
    .map(({ id, score }) => {
      const doc = docMap.get(id);
      if (!doc) return null;
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
          scope,
          sessionDate: doc.sessionDate,
        },
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

// ── Scope filters ───────────────────────────────────────────────────────────

function filterByScope(
  scope: SearchScope,
  messages: SessionMessage[],
): SessionMessage[] {
  if (scope === 'all') {
    return messages;
  }

  if (scope === 'tools') {
    return messages.filter(
      m => m.role === 'tool_use' || m.role === 'tool_result',
    );
  }

  const pattern = SCOPE_PATTERNS[scope];
  return messages.filter(m => pattern.test(m.content));
}

// buildExcerpt imported from ../search/excerpt.js
