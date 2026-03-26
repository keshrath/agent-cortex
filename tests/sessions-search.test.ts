import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { searchSessions } from '../src/sessions/search.js';
import * as parser from '../src/sessions/parser.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-ssearch-test-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function createSessionFile(dir: string, sessionId: string, entries: object[]): void {
  const content = entries.map(e => JSON.stringify(e)).join('\n');
  fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), content);
}

describe('searchSessions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    const projectDir = path.join(tmpDir, 'my-project');
    fs.mkdirSync(projectDir, { recursive: true });

    createSessionFile(projectDir, 'sess-typescript', [
      { type: 'user', timestamp: '2026-01-01T00:00:00Z', cwd: '/proj', message: { role: 'user', content: 'How do I configure TypeScript for ESM modules?' } },
      { type: 'assistant', timestamp: '2026-01-01T00:00:01Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Set module to NodeNext in tsconfig.json' }] } },
    ]);

    createSessionFile(projectDir, 'sess-python', [
      { type: 'user', timestamp: '2026-01-02T00:00:00Z', cwd: '/proj', message: { role: 'user', content: 'How do I setup Python virtual environment?' } },
      { type: 'assistant', timestamp: '2026-01-02T00:00:01Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Use python -m venv .venv to create a virtual environment' }] } },
    ]);

    createSessionFile(projectDir, 'sess-database', [
      { type: 'user', timestamp: '2026-01-03T00:00:00Z', cwd: '/proj', message: { role: 'user', content: 'What database should I use for this TypeScript project?' } },
      { type: 'assistant', timestamp: '2026-01-03T00:00:01Z', message: { role: 'assistant', content: [{ type: 'text', text: 'PostgreSQL is a great choice for TypeScript applications' }] } },
    ]);

    vi.spyOn(parser, 'getProjectDirs').mockReturnValue([
      { name: 'my-project', path: projectDir },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup(tmpDir);
  });

  // ── Ranked (TF-IDF) mode ─────────────────────────────────────────────────

  it('returns ranked results by TF-IDF relevance', () => {
    const results = searchSessions('TypeScript');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('ranks results with most relevant first', () => {
    const results = searchSessions('TypeScript');
    // Results about TypeScript should come first
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('includes source, id, project, excerpt, and score fields', () => {
    const results = searchSessions('TypeScript');
    expect(results.length).toBeGreaterThan(0);
    const r = results[0];
    expect(r.source).toBe('session');
    expect(typeof r.id).toBe('string');
    expect(typeof r.project).toBe('string');
    expect(typeof r.excerpt).toBe('string');
    expect(typeof r.score).toBe('number');
  });

  it('filters by role (user only)', () => {
    const results = searchSessions('TypeScript', { role: 'user' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every(r => r.role === 'user')).toBe(true);
  });

  it('filters by role (assistant only)', () => {
    const results = searchSessions('TypeScript', { role: 'assistant' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every(r => r.role === 'assistant')).toBe(true);
  });

  it('returns all roles by default', () => {
    const results = searchSessions('TypeScript');
    const roles = new Set(results.map(r => r.role));
    expect(roles.size).toBeGreaterThanOrEqual(1);
  });

  it('respects maxResults limit', () => {
    const results = searchSessions('TypeScript', { maxResults: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('returns empty for query with only stopwords', () => {
    const results = searchSessions('the and or but');
    expect(results).toEqual([]);
  });

  it('filters by project name', () => {
    const results = searchSessions('TypeScript', { project: 'my-project' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every(r => r.project === 'my-project')).toBe(true);
  });

  it('returns fewer or no results when project filter excludes matches', () => {
    const matched = searchSessions('TypeScript', { project: 'my-project' });
    const filtered = searchSessions('TypeScript', { project: 'xyznonexist999zzz' });
    expect(filtered.length).toBeLessThanOrEqual(matched.length);
  });

  // ── Regex mode ───────────────────────────────────────────────────────────

  it('supports regex mode with ranked=false', () => {
    const results = searchSessions('TypeScript', { ranked: false });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every(r => r.score === 1)).toBe(true); // regex mode uses score=1
  });

  it('regex mode handles special characters gracefully', () => {
    const results = searchSessions('test[invalid(regex', { ranked: false });
    expect(Array.isArray(results)).toBe(true);
  });

  it('regex mode respects role filter', () => {
    const results = searchSessions('TypeScript', { ranked: false, role: 'user' });
    expect(results.every(r => r.role === 'user')).toBe(true);
  });

  it('regex mode respects maxResults', () => {
    const results = searchSessions('TypeScript', { ranked: false, maxResults: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('regex mode includes excerpts', () => {
    const results = searchSessions('TypeScript', { ranked: false });
    if (results.length > 0) {
      expect(results[0].excerpt.length).toBeGreaterThan(0);
    }
  });
});
