export interface SearchResult {
  source: 'session' | 'knowledge';
  id: string;
  project?: string;
  title?: string;
  role?: string;
  timestamp?: string;
  excerpt: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  query: string;
  maxResults?: number;
  caseSensitive?: boolean;
  fuzzy?: boolean;
  fuzzyThreshold?: number;
}
