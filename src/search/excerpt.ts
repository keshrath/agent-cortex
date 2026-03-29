/**
 * Shared excerpt-building utility.
 *
 * Extracts a window of text around the first occurrence of `query`,
 * with configurable context on each side.
 */
export function buildExcerpt(
  text: string,
  query: string,
  options: { contextBefore?: number; contextAfter?: number; caseSensitive?: boolean } = {},
): string {
  const { contextBefore = 100, contextAfter = 100, caseSensitive = false } = options;

  if (!text) return '';
  if (!query) return text.substring(0, 300) + (text.length > 300 ? '...' : '');

  let idx: number;
  try {
    idx = text.search(new RegExp(query, caseSensitive ? '' : 'i'));
  } catch (err) {
    console.error('[knowledge] excerpt regex:', err instanceof Error ? err.message : err);
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    idx = text.search(new RegExp(escaped, caseSensitive ? '' : 'i'));
  }

  if (idx === -1) {
    return text.substring(0, 300) + (text.length > 300 ? '...' : '');
  }

  const start = Math.max(0, idx - contextBefore);
  const end = Math.min(text.length, idx + query.length + contextAfter);

  return (
    (start > 0 ? '...' : '') + text.substring(start, end).trim() + (end < text.length ? '...' : '')
  );
}
