import { describe, it, expect } from 'vitest';
import { chunkKnowledge, chunkSession } from '../src/vectorstore/chunker.js';
import type { SessionMessage } from '../src/vectorstore/chunker.js';

describe('chunkKnowledge', () => {
  it('returns single chunk for short text', () => {
    const chunks = chunkKnowledge('Hello world, this is a short text.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].text).toBe('Hello world, this is a short text.');
  });

  it('returns empty array for empty text', () => {
    expect(chunkKnowledge('')).toEqual([]);
  });

  it('returns empty array for whitespace-only text', () => {
    expect(chunkKnowledge('   \n\n  ')).toEqual([]);
  });

  it('splits long text at headers', () => {
    const text = '## Section One\n' +
      'A'.repeat(800) + '\n\n' +
      '## Section Two\n' +
      'B'.repeat(800) + '\n\n' +
      '## Section Three\n' +
      'C'.repeat(800);

    const chunks = chunkKnowledge(text);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0].text).toContain('Section One');
    expect(chunks[1].text).toContain('Section Two');
    expect(chunks[2].text).toContain('Section Three');
  });

  it('strips YAML frontmatter', () => {
    const text = '---\ntitle: Test Document\ndate: 2026-01-01\n---\nActual content here.';
    const chunks = chunkKnowledge(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].text).not.toContain('---');
    expect(chunks[0].text).not.toContain('title:');
    expect(chunks[0].text).toContain('Actual content');
  });

  it('splits at paragraphs when no headers present', () => {
    const para = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ';
    const longText = (para.repeat(20) + '\n\n').repeat(10);
    const chunks = chunkKnowledge(longText, 500);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('maintains overlap between chunks for long sections', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog. ';
    const longSection = '## Big Section\n' + sentence.repeat(100);
    const chunks = chunkKnowledge(longSection, 1000);
    expect(chunks.length).toBeGreaterThan(1);

    for (let i = 0; i < chunks.length - 1; i++) {
      const endOfCurrent = chunks[i].text.slice(-100);
      const startOfNext = chunks[i + 1].text.slice(0, 300);
      const words = endOfCurrent.split(/\s+/).filter(w => w.length > 2);
      const hasOverlap = words.some(word => startOfNext.includes(word));
      expect(hasOverlap).toBe(true);
    }
  });

  it('assigns sequential indices to chunks', () => {
    const text = '## Section A\n' + 'Alpha content here. '.repeat(40) +
      '\n## Section B\n' + 'Beta content here. '.repeat(40);
    const chunks = chunkKnowledge(text, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });

  it('handles different header levels', () => {
    const text = '# H1\n' + 'Content one.\n\n' +
      '## H2\n' + 'Content two.\n\n' +
      '### H3\n' + 'Content three.\n\n' +
      '#### H4\n' + 'Content four.';
    const chunks = chunkKnowledge(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});

describe('chunkSession', () => {
  it('creates one chunk per message', () => {
    const messages: SessionMessage[] = [
      { role: 'user', text: 'Hello, how are you?' },
      { role: 'assistant', text: 'I am doing well, thanks!' },
    ];
    const chunks = chunkSession(messages);
    expect(chunks).toHaveLength(2);
  });

  it('includes role prefix in chunk text', () => {
    const messages: SessionMessage[] = [
      { role: 'user', text: 'What is TypeScript?' },
    ];
    const chunks = chunkSession(messages);
    expect(chunks[0].text).toContain('[user]:');
    expect(chunks[0].text).toContain('What is TypeScript?');
  });

  it('includes assistant role prefix', () => {
    const messages: SessionMessage[] = [
      { role: 'assistant', text: 'TypeScript is a typed superset of JavaScript.' },
    ];
    const chunks = chunkSession(messages);
    expect(chunks[0].text).toContain('[assistant]:');
  });

  it('splits very long messages into multiple chunks', () => {
    const longText = 'word '.repeat(1000);
    const messages: SessionMessage[] = [
      { role: 'user', text: longText },
    ];
    const chunks = chunkSession(messages, 200);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('includes metadata with role', () => {
    const messages: SessionMessage[] = [
      { role: 'user', text: 'Hello' },
    ];
    const chunks = chunkSession(messages);
    expect(chunks[0].metadata).toBeDefined();
    expect(chunks[0].metadata!.role).toBe('user');
  });

  it('includes metadata with timestamp when provided', () => {
    const messages: SessionMessage[] = [
      { role: 'user', text: 'Hello', timestamp: '2026-01-01T00:00:00Z' },
    ];
    const chunks = chunkSession(messages);
    expect(chunks[0].metadata!.timestamp).toBe('2026-01-01T00:00:00Z');
  });

  it('includes metadata with sessionId when provided', () => {
    const messages: SessionMessage[] = [
      { role: 'user', text: 'Hello', sessionId: 'sess-123' },
    ];
    const chunks = chunkSession(messages);
    expect(chunks[0].metadata!.sessionId).toBe('sess-123');
  });

  it('skips empty messages', () => {
    const messages: SessionMessage[] = [
      { role: 'user', text: '' },
      { role: 'assistant', text: 'Valid message' },
    ];
    const chunks = chunkSession(messages);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('Valid message');
  });

  it('assigns sequential indices', () => {
    const messages: SessionMessage[] = [
      { role: 'user', text: 'First' },
      { role: 'assistant', text: 'Second' },
      { role: 'user', text: 'Third' },
    ];
    const chunks = chunkSession(messages);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });

  it('split long messages include part in metadata', () => {
    const longText = 'word '.repeat(1000);
    const messages: SessionMessage[] = [
      { role: 'user', text: longText },
    ];
    const chunks = chunkSession(messages, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.metadata).toBeDefined();
      expect(typeof chunk.metadata!.part).toBe('number');
    }
  });

  it('returns empty array for empty input', () => {
    expect(chunkSession([])).toEqual([]);
  });
});
