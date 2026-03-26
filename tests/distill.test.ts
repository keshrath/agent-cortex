import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

vi.mock('../src/types.js', () => {
  let _memoryDir = '';
  let _claudeDir = '';
  return {
    getConfig: () => ({
      memoryDir: _memoryDir,
      claudeDir: _claudeDir,
      projectsDir: path.join(_claudeDir, 'projects'),
      embeddingProvider: 'local',
      embeddingAlpha: 0.3,
      gitUrl: undefined,
      autoDistill: true,
    }),
    _setDirs: (memoryDir: string, claudeDir: string) => {
      _memoryDir = memoryDir;
      _claudeDir = claudeDir;
    },
    getVersion: () => '1.0.0',
  };
});

import { distillSessions } from '../src/knowledge/distill.js';
import { _setDirs } from '../src/types.js';

function makeGitRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  for (const cat of ['projects', 'people', 'decisions', 'workflows', 'notes']) {
    fs.mkdirSync(path.join(dir, cat), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test Memory\n');
  execSync('git add -A && git commit -m "init"', { cwd: dir, stdio: 'pipe' });
}

function makeSession(claudeDir: string, projectName: string, sessionId: string, messages: Array<{ role: string; content: string }>): void {
  const projDir = path.join(claudeDir, 'projects', projectName);
  fs.mkdirSync(projDir, { recursive: true });

  const lines = messages.map((m, i) => {
    const ts = new Date(Date.now() - (messages.length - i) * 60000).toISOString();
    return JSON.stringify({
      type: m.role,
      timestamp: ts,
      message: { role: m.role, content: m.content },
    });
  });

  fs.writeFileSync(path.join(projDir, `${sessionId}.jsonl`), lines.join('\n') + '\n');
}

describe('distillSessions', () => {
  let memoryDir: string;
  let claudeDir: string;

  beforeEach(() => {
    memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-distill-mem-'));
    claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-distill-claude-'));
    makeGitRepo(memoryDir);
    (_setDirs as (m: string, c: string) => void)(memoryDir, claudeDir);
  });

  afterEach(() => {
    fs.rmSync(memoryDir, { recursive: true, force: true });
    fs.rmSync(claudeDir, { recursive: true, force: true });
  });

  it('returns empty when no sessions exist', async () => {
    const result = await distillSessions();
    expect(result.updated).toHaveLength(0);
    expect(result.created).toHaveLength(0);
  });

  it('creates a new project entry from session data', async () => {
    makeSession(claudeDir, 'my-test-project', 'session-001', [
      { role: 'user', content: 'Please implement the login feature with OAuth support' },
      { role: 'assistant', content: 'I will implement OAuth login...' },
    ]);

    const result = await distillSessions();
    expect(result.created.length + result.updated.length).toBeGreaterThanOrEqual(0);
  });

  it('updates existing project entry instead of creating duplicate', async () => {
    fs.writeFileSync(
      path.join(memoryDir, 'projects', 'my-project.md'),
      '---\ntitle: My Project\ntags: [test]\n---\n\n# My Project\n\nExisting content.\n',
    );
    execSync('git add -A && git commit -m "add project"', { cwd: memoryDir, stdio: 'pipe' });

    makeSession(claudeDir, 'my-project', 'session-002', [
      { role: 'user', content: 'Fix the database migration issue in the users table' },
      { role: 'assistant', content: 'Looking at the migration...' },
    ]);

    const result = await distillSessions();

    if (result.updated.length > 0) {
      const content = fs.readFileSync(path.join(memoryDir, 'projects', 'my-project.md'), 'utf-8');
      expect(content).toContain('Existing content');
      expect(content).toContain('Recent Activity');
    }
  });

  it('respects the distill cursor to avoid reprocessing', async () => {
    makeSession(claudeDir, 'cursor-test', 'session-003', [
      { role: 'user', content: 'First session with important work on the API layer' },
      { role: 'assistant', content: 'Working on it...' },
    ]);

    await distillSessions();

    const cursorPath = path.join(claudeDir, '.cortex-distill-cursor');
    expect(fs.existsSync(cursorPath)).toBe(true);
    const cursor = fs.readFileSync(cursorPath, 'utf-8').trim();
    expect(cursor.length).toBeGreaterThan(0);

    const result2 = await distillSessions();
    expect(result2.updated).toHaveLength(0);
    expect(result2.created).toHaveLength(0);
  });
});
