import { describe, it, expect } from 'vitest';
import { levenshtein, fuzzyMatch, fuzzySearch } from '../src/search/fuzzy.js';

describe('levenshtein', () => {
  it('returns 0 for exact match', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns 1 for a single edit', () => {
    expect(levenshtein('cat', 'car')).toBe(1);
    expect(levenshtein('cat', 'cats')).toBe(1);
    expect(levenshtein('cat', 'at')).toBe(1);
  });
});

describe('fuzzyMatch', () => {
  it('returns a high score for an exact substring match', () => {
    const matches = fuzzyMatch('typescript', 'I love typescript programming');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].score).toBeGreaterThanOrEqual(0.99);
  });

  it('returns results for a close match', () => {
    const matches = fuzzyMatch('typscript', 'I love typescript programming');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].score).toBeGreaterThan(0.7);
    expect(matches[0].score).toBeLessThan(1.0);
  });

  it('returns empty for matches below threshold', () => {
    const matches = fuzzyMatch('abcdef', 'zyxwvu', 0.8);
    expect(matches.length).toBe(0);
  });
});

describe('fuzzySearch', () => {
  it('searches across multiple texts and returns ranked results', () => {
    const texts = [
      { id: 'a', text: 'typescript programming' },
      { id: 'b', text: 'javascript development' },
      { id: 'c', text: 'python scripting' },
    ];
    const results = fuzzySearch('typescrip', texts, 0.6);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('a');
  });

  it('returns empty when nothing meets the threshold', () => {
    const texts = [{ id: 'a', text: 'completely unrelated content' }];
    const results = fuzzySearch('zzzzzzzzz', texts, 0.8);
    expect(results).toEqual([]);
  });
});
