import { searchSessions } from './search.js';
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
 * Uses the shared cached TF-IDF index from searchSessions, then post-filters
 * results by scope patterns. Much faster than building a separate index.
 */
export function scopedSearch(
  scope: SearchScope,
  query: string,
  options: ScopedSearchOptions = {},
): SearchResult[] {
  const { project, maxResults = 20 } = options;

  const role = scope === 'tools' ? 'all' : 'all';
  const candidates = searchSessions(query, {
    project,
    role,
    maxResults: maxResults * 5, // over-fetch for filtering
    ranked: true,
  });

  if (scope === 'all') {
    return candidates.slice(0, maxResults).map(r => ({
      ...r,
      metadata: { ...r.metadata, scope },
    }));
  }

  // Post-filter by scope pattern
  const pattern = scope === 'tools' ? null : SCOPE_PATTERNS[scope];
  const filtered: SearchResult[] = [];

  for (const result of candidates) {
    if (filtered.length >= maxResults) break;

    if (scope === 'tools') {
      if (result.role === 'tool_use' || result.role === 'tool_result') {
        filtered.push({ ...result, metadata: { ...result.metadata, scope } });
      }
    } else if (pattern && pattern.test(result.excerpt)) {
      filtered.push({ ...result, metadata: { ...result.metadata, scope } });
    }
  }

  return filtered;
}

