import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { gitPull, gitPush, gitSync } from '../src/knowledge/git.js';

function makeTmpGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-git-test-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test\n');
  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "initial"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('gitPull', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpGitRepo();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('succeeds on a repo with no remote (graceful failure)', async () => {
    const result = await gitPull(tmpDir);
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.message).toBe('string');
  });
});

describe('gitPush', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpGitRepo();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('commits new files when there are changes', async () => {
    fs.mkdirSync(path.join(tmpDir, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'notes', 'test.md'), 'test content');

    const result = await gitPush(tmpDir, 'test commit');
    const log = execSync('git log --oneline', { cwd: tmpDir, stdio: 'pipe' }).toString();
    expect(log).toContain('test commit');
  });

  it('does not create empty commits when nothing changed', async () => {
    const logBefore = execSync('git log --oneline', { cwd: tmpDir, stdio: 'pipe' }).toString();
    const countBefore = logBefore.trim().split('\n').length;

    await gitPush(tmpDir, 'should not appear');

    const logAfter = execSync('git log --oneline', { cwd: tmpDir, stdio: 'pipe' }).toString();
    const countAfter = logAfter.trim().split('\n').length;

    expect(countAfter).toBe(countBefore);
  });

  it('uses default commit message when none provided', async () => {
    fs.writeFileSync(path.join(tmpDir, 'new.md'), 'content');
    await gitPush(tmpDir);
    const log = execSync('git log --oneline', { cwd: tmpDir, stdio: 'pipe' }).toString();
    expect(log).toContain('update knowledge base');
  });

  it('handles special characters in commit message safely', async () => {
    fs.writeFileSync(path.join(tmpDir, 'special.md'), 'content');
    await gitPush(tmpDir, 'test `whoami` $(echo hack) "quotes" & | ;');
    const log = execSync('git log -1 --format=%s', { cwd: tmpDir, stdio: 'pipe' }).toString().trim();
    expect(log).toContain('test');
  });
});

describe('gitSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpGitRepo();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('returns both pull and push results', async () => {
    const result = await gitSync(tmpDir);
    expect(result).toHaveProperty('pull');
    expect(result).toHaveProperty('push');
    expect(typeof result.pull.success).toBe('boolean');
    expect(typeof result.push.success).toBe('boolean');
  });
});
