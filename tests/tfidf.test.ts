import { describe, it, expect, beforeEach } from 'vitest';
import { TfIdfIndex, recencyDecay } from '../src/search/tfidf.js';

describe('TfIdfIndex', () => {
  let index: TfIdfIndex;

  beforeEach(() => {
    index = new TfIdfIndex();
  });

  it('tokenizes text to lowercase and removes stopwords', () => {
    index.addDocument('doc1', 'The Quick Brown Fox Jumps Over The Lazy Dog');
    const results = index.search('quick brown fox');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('doc1');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('scores a single document correctly', () => {
    index.addDocument('doc1', 'typescript programming language features');
    const results = index.search('typescript');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('doc1');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('ranks multiple documents with most relevant first', () => {
    index.addDocument('doc1', 'javascript is a programming language');
    index.addDocument('doc2', 'typescript typescript typescript is great for typed programming');
    index.addDocument('doc3', 'python is also a language');
    const results = index.search('typescript');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('doc2');
  });

  it('returns empty results for an empty query', () => {
    index.addDocument('doc1', 'some content here');
    const results = index.search('');
    expect(results).toEqual([]);
  });

  it('resets the index when clear() is called', () => {
    index.addDocument('doc1', 'hello world');
    index.addDocument('doc2', 'foo bar baz');
    index.clear();
    const results = index.search('hello');
    expect(results).toEqual([]);
  });

  it('handles special characters in the query gracefully', () => {
    index.addDocument('doc1', 'error handling with try catch');
    const results = index.search('error!!! @#$ handling???');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('doc1');
  });

  it('updates correctly when re-adding a document with the same ID', () => {
    index.addDocument('doc1', 'old content about databases');
    index.addDocument('doc1', 'new content about networking');
    const oldResults = index.search('databases');
    const newResults = index.search('networking');
    expect(oldResults.length).toBe(0);
    expect(newResults.length).toBe(1);
    expect(newResults[0].id).toBe('doc1');
  });

  it('respects the max results limit', () => {
    for (let i = 0; i < 20; i++) {
      index.addDocument(`doc${i}`, `common term document number ${i}`);
    }
    const results = index.search('common term', 5);
    expect(results.length).toBe(5);
  });
});

describe('recencyDecay', () => {
  it('returns 1.0 for timestamps from right now', () => {
    const now = new Date().toISOString();
    expect(recencyDecay(now)).toBeCloseTo(1.0, 1);
  });

  it('returns ~0.5 for timestamps exactly one half-life ago', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyDecay(thirtyDaysAgo, 30)).toBeCloseTo(0.5, 1);
  });

  it('returns ~0.25 for timestamps two half-lives ago', () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyDecay(sixtyDaysAgo, 30)).toBeCloseTo(0.25, 1);
  });

  it('floors at 0.1 for very old timestamps', () => {
    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyDecay(yearAgo, 30)).toBe(0.1);
  });

  it('returns 0.5 for null timestamps', () => {
    expect(recencyDecay(null)).toBe(0.5);
  });

  it('returns 1.0 for future timestamps', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(recencyDecay(future)).toBe(1.0);
  });

  it('respects custom half-life', () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyDecay(sevenDaysAgo, 7)).toBeCloseTo(0.5, 1);
  });

  it('decay is monotonically decreasing with age', () => {
    const d1 = recencyDecay(new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString());
    const d7 = recencyDecay(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    const d30 = recencyDecay(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    const d90 = recencyDecay(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());
    expect(d1).toBeGreaterThan(d7);
    expect(d7).toBeGreaterThan(d30);
    expect(d30).toBeGreaterThan(d90);
  });
});
