import { describe, it, expect, beforeEach } from 'vitest';
import { TfIdfIndex } from '../src/search/tfidf.js';

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
