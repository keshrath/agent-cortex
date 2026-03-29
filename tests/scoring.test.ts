import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  EntryScoring,
  decayFactor,
  maturityMultiplier,
  computeFinalScore,
} from '../src/knowledge/scoring.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-scoring-test-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('EntryScoring', () => {
  let tmpDir: string;
  let dbPath: string;
  let scoring: EntryScoring;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    dbPath = path.join(tmpDir, 'test-scoring.db');
    scoring = new EntryScoring(dbPath);
  });

  afterEach(() => {
    try {
      scoring.close();
    } catch {
      /* ignore */
    }
    cleanup(tmpDir);
  });

  describe('recordAccess', () => {
    it('creates a new score record on first access', () => {
      const score = scoring.recordAccess('projects/test.md');
      expect(score.entry_path).toBe('projects/test.md');
      expect(score.access_count).toBe(1);
      expect(score.maturity).toBe('candidate');
      expect(score.last_accessed).toBeTruthy();
    });

    it('increments access_count on repeated access', () => {
      scoring.recordAccess('projects/test.md');
      scoring.recordAccess('projects/test.md');
      const score = scoring.recordAccess('projects/test.md');
      expect(score.access_count).toBe(3);
    });

    it('auto-promotes candidate to established at 5 accesses', () => {
      for (let i = 0; i < 4; i++) {
        scoring.recordAccess('projects/test.md');
      }
      const score = scoring.recordAccess('projects/test.md');
      expect(score.access_count).toBe(5);
      expect(score.maturity).toBe('established');
    });

    it('auto-promotes established to proven at 20 accesses', () => {
      for (let i = 0; i < 19; i++) {
        scoring.recordAccess('projects/test.md');
      }
      const score = scoring.recordAccess('projects/test.md');
      expect(score.access_count).toBe(20);
      expect(score.maturity).toBe('proven');
    });
  });

  describe('recordBulkAccess', () => {
    it('records access for multiple entries', () => {
      scoring.recordBulkAccess(['a.md', 'b.md', 'c.md']);
      expect(scoring.getScore('a.md')?.access_count).toBe(1);
      expect(scoring.getScore('b.md')?.access_count).toBe(1);
      expect(scoring.getScore('c.md')?.access_count).toBe(1);
    });

    it('handles empty array', () => {
      expect(() => scoring.recordBulkAccess([])).not.toThrow();
    });
  });

  describe('getScore', () => {
    it('returns null for unknown entry', () => {
      expect(scoring.getScore('unknown.md')).toBeNull();
    });

    it('returns score after access', () => {
      scoring.recordAccess('test.md');
      const score = scoring.getScore('test.md');
      expect(score).not.toBeNull();
      expect(score!.access_count).toBe(1);
    });
  });

  describe('getScores', () => {
    it('returns scores for multiple entries', () => {
      scoring.recordAccess('a.md');
      scoring.recordAccess('b.md');
      const scores = scoring.getScores(['a.md', 'b.md', 'missing.md']);
      expect(scores.size).toBe(2);
      expect(scores.has('a.md')).toBe(true);
      expect(scores.has('b.md')).toBe(true);
      expect(scores.has('missing.md')).toBe(false);
    });
  });
});

describe('decayFactor', () => {
  it('returns ~1.0 for just-accessed entry', () => {
    const now = new Date().toISOString();
    const decay = decayFactor(now);
    expect(decay).toBeCloseTo(1.0, 1);
  });

  it('returns ~0.5 for 90-day-old access', () => {
    const date = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const decay = decayFactor(date);
    expect(decay).toBeCloseTo(0.5, 1);
  });

  it('returns ~0.25 for 180-day-old access', () => {
    const date = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const decay = decayFactor(date);
    expect(decay).toBeCloseTo(0.25, 1);
  });

  it('returns 1.0 for invalid date', () => {
    expect(decayFactor('not-a-date')).toBe(1);
  });
});

describe('maturityMultiplier', () => {
  it('returns 0.5 for candidate', () => {
    expect(maturityMultiplier('candidate')).toBe(0.5);
  });

  it('returns 1.0 for established', () => {
    expect(maturityMultiplier('established')).toBe(1.0);
  });

  it('returns 1.5 for proven', () => {
    expect(maturityMultiplier('proven')).toBe(1.5);
  });
});

describe('computeFinalScore', () => {
  it('computes base * decay * maturity', () => {
    const now = new Date().toISOString();
    const score = computeFinalScore(1.0, now, 'established');
    expect(score).toBeCloseTo(1.0, 1);
  });

  it('handles null lastAccessed', () => {
    const score = computeFinalScore(1.0, null, 'candidate');
    expect(score).toBe(0.5);
  });

  it('applies decay and maturity together', () => {
    const date90DaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const score = computeFinalScore(1.0, date90DaysAgo, 'proven');
    expect(score).toBeCloseTo(0.75, 1);
  });
});
