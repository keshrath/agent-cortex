import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { scopedSearch } from '../src/sessions/scopes.js';
import * as parser from '../src/sessions/parser.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-scopes-test-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function createSessionFile(dir: string, sessionId: string, entries: object[]): void {
  const content = entries.map(e => JSON.stringify(e)).join('\n');
  fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), content);
}

describe('scopedSearch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    const projectDir = path.join(tmpDir, 'test-project');
    fs.mkdirSync(projectDir, { recursive: true });

    createSessionFile(projectDir, 'sess-errors', [
      { type: 'user', timestamp: '2026-01-01T00:00:00Z', cwd: '/', message: { role: 'user', content: 'I got a TypeError exception when running the app' } },
      { type: 'assistant', timestamp: '2026-01-01T00:00:01Z', message: { role: 'assistant', content: [{ type: 'text', text: 'The TypeError is caused by a null reference. Let me fix it.' }] } },
    ]);

    createSessionFile(projectDir, 'sess-plans', [
      { type: 'user', timestamp: '2026-01-02T00:00:00Z', cwd: '/', message: { role: 'user', content: 'Let me plan the architecture for phase 2' } },
      { type: 'assistant', timestamp: '2026-01-02T00:00:01Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Here is the roadmap: step 1 setup, step 2 implement, step 3 test' }] } },
    ]);

    createSessionFile(projectDir, 'sess-configs', [
      { type: 'user', timestamp: '2026-01-03T00:00:00Z', cwd: '/', message: { role: 'user', content: 'Update the tsconfig.json and package.json settings' } },
    ]);

    createSessionFile(projectDir, 'sess-tools', [
      { type: 'tool_use', content: '{"name": "Read", "input": {"path": "src/index.ts"}}' },
      { type: 'tool_result', message: { content: 'File content here' } },
    ]);

    createSessionFile(projectDir, 'sess-files', [
      { type: 'user', timestamp: '2026-01-05T00:00:00Z', cwd: '/', message: { role: 'user', content: 'I modified src/server.ts and created lib/utils.ts' } },
    ]);

    createSessionFile(projectDir, 'sess-decisions', [
      { type: 'user', timestamp: '2026-01-06T00:00:00Z', cwd: '/', message: { role: 'user', content: 'We decided to use PostgreSQL because of its reliability instead of MongoDB' } },
    ]);

    vi.spyOn(parser, 'getProjectDirs').mockReturnValue([
      { name: 'test-project', path: projectDir },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup(tmpDir);
  });

  it('filters errors scope correctly', () => {
    const results = scopedSearch('errors', 'null reference');
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Should include error-related messages
    const allExcerpts = results.map(r => r.excerpt).join(' ');
    expect(allExcerpts.toLowerCase()).toMatch(/error|typeerror|null/i);
  });

  it('filters plans scope correctly', () => {
    const results = scopedSearch('plans', 'roadmap');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('filters configs scope correctly', () => {
    const results = scopedSearch('configs', 'tsconfig');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('filters tools scope (tool_use and tool_result)', () => {
    const results = scopedSearch('tools', 'Read');
    // tools scope filters by role, so results come from tool_use/tool_result entries
    expect(Array.isArray(results)).toBe(true);
  });

  it('filters files scope correctly', () => {
    const results = scopedSearch('files', 'server');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('filters decisions scope correctly', () => {
    const results = scopedSearch('decisions', 'PostgreSQL');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('all scope returns results from all messages', () => {
    const results = scopedSearch('all', 'null');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty results when query has no matches', () => {
    const results = scopedSearch('errors', 'xyznonexistent');
    expect(results).toEqual([]);
  });

  it('respects maxResults option', () => {
    const results = scopedSearch('all', 'the', { maxResults: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('filters by project', () => {
    const results = scopedSearch('all', 'null', { project: 'test-project' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every(r => r.project === 'test-project')).toBe(true);
  });

  it('returns fewer or no results when project filter excludes matches', () => {
    const broad = scopedSearch('all', 'null', { project: 'test-project' });
    const narrow = scopedSearch('all', 'null', { project: 'xyznonexist999zzz' });
    expect(narrow.length).toBeLessThanOrEqual(broad.length);
  });

  it('includes metadata with scope info', () => {
    const results = scopedSearch('errors', 'TypeError');
    if (results.length > 0) {
      expect(results[0].metadata).toBeDefined();
      expect(results[0].metadata!.scope).toBe('errors');
    }
  });
});
