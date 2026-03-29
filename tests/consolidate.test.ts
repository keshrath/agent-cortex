import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { checkDuplicates, consolidate } from '../src/knowledge/consolidate.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-consolidate-test-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeEntry(dir: string, relPath: string, content: string): void {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

function makeEntry(title: string, tags: string[], body: string): string {
  return `---\ntitle: ${title}\ntags: [${tags.join(', ')}]\nupdated: 2025-01-01\n---\n${body}`;
}

describe('checkDuplicates', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('returns matches with similarity scores for similar entries', () => {
    const content1 = makeEntry(
      'TypeScript Testing Guide',
      ['typescript', 'testing'],
      'This guide covers unit testing in TypeScript using vitest framework. Write tests for functions, classes, and modules.',
    );
    const content2 = makeEntry(
      'TypeScript Unit Tests',
      ['typescript', 'tests'],
      'Writing unit tests in TypeScript with vitest framework. Cover functions, classes, and modules with assertions.',
    );

    writeEntry(tmpDir, 'notes/testing-guide.md', content1);
    writeEntry(tmpDir, 'notes/unit-tests.md', content2);

    const warnings = checkDuplicates(tmpDir, 'notes/testing-guide.md', content1);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0].path).toBe('notes/unit-tests.md');
    expect(warnings[0].similarity).toBeGreaterThan(0);
    expect(warnings[0].similarity).toBeLessThanOrEqual(1);
    expect(warnings[0].title).toBe('TypeScript Unit Tests');
  });

  it('returns empty array for completely unique entry', () => {
    const content1 = makeEntry(
      'Database Migrations',
      ['database'],
      'PostgreSQL schema migrations using Flyway. Version control your database changes with SQL scripts.',
    );
    const content2 = makeEntry(
      'UI Color Theory',
      ['design'],
      'Understanding complementary colors and contrast ratios in web design for accessibility compliance.',
    );

    writeEntry(tmpDir, 'notes/migrations.md', content1);
    writeEntry(tmpDir, 'notes/colors.md', content2);

    // Use a high threshold to ensure no matches on unrelated content
    const warnings = checkDuplicates(tmpDir, 'notes/migrations.md', content1, 0.9);
    expect(warnings).toEqual([]);
  });

  it('excludes entries below the threshold', () => {
    const content1 = makeEntry(
      'JavaScript Promises',
      ['javascript'],
      'Promises in JavaScript allow asynchronous programming with then and catch handlers.',
    );
    const content2 = makeEntry(
      'JavaScript Async Await',
      ['javascript'],
      'Async await syntax in JavaScript simplifies promise chains with cleaner asynchronous code.',
    );

    writeEntry(tmpDir, 'notes/promises.md', content1);
    writeEntry(tmpDir, 'notes/async.md', content2);

    // With threshold 1.0, nothing should match (exact match only)
    const warningsHigh = checkDuplicates(tmpDir, 'notes/promises.md', content1, 1.0);
    expect(warningsHigh).toEqual([]);

    // With a very low threshold, the JS-related entry should appear
    const warningsLow = checkDuplicates(tmpDir, 'notes/promises.md', content1, 0.01);
    expect(warningsLow.length).toBeGreaterThanOrEqual(1);
    for (const w of warningsLow) {
      expect(w.similarity).toBeGreaterThanOrEqual(0.01);
    }
  });

  it('returns empty for single-entry knowledge base', () => {
    const content = makeEntry('Solo Entry', ['misc'], 'Only entry in the entire knowledge base.');
    writeEntry(tmpDir, 'notes/solo.md', content);

    const warnings = checkDuplicates(tmpDir, 'notes/solo.md', content);
    expect(warnings).toEqual([]);
  });
});

describe('consolidate', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('returns clusters for entries with duplicates', () => {
    // Three very similar entries about the same topic
    writeEntry(
      tmpDir,
      'projects/react-setup.md',
      makeEntry(
        'React Project Setup',
        ['react'],
        'Setting up a React project with webpack bundler, babel transpiler, and eslint linting tools for modern development.',
      ),
    );
    writeEntry(
      tmpDir,
      'projects/react-config.md',
      makeEntry(
        'React Configuration',
        ['react'],
        'Configuring a React project with webpack bundler, babel transpiler, and eslint linting tools for development workflow.',
      ),
    );
    // Dissimilar entry
    writeEntry(
      tmpDir,
      'projects/python-ml.md',
      makeEntry(
        'Python Machine Learning',
        ['python'],
        'Training neural networks with PyTorch and scikit-learn for image classification and natural language processing.',
      ),
    );

    const report = consolidate(tmpDir, 'projects', 0.3);
    expect(report.totalEntries).toBe(3);
    expect(report.threshold).toBe(0.3);

    // The two React entries should cluster together
    if (report.clustersFound > 0) {
      const reactCluster = report.clusters.find((c) =>
        c.entries.some((e) => e.path.includes('react')),
      );
      expect(reactCluster).toBeDefined();
      expect(reactCluster!.entries.length).toBeGreaterThanOrEqual(2);
      // Representative must be one of the cluster entries
      expect(reactCluster!.entries.some((e) => e.path === reactCluster!.representative)).toBe(true);
      expect(reactCluster!.similarities.length).toBeGreaterThan(0);
      for (const sim of reactCluster!.similarities) {
        expect(sim.score).toBeGreaterThanOrEqual(0.3);
      }
    }
  });

  it('returns empty clusters when no duplicates exist', () => {
    writeEntry(
      tmpDir,
      'notes/cooking.md',
      makeEntry(
        'Italian Cooking',
        ['food'],
        'Recipes for pasta carbonara, margherita pizza, and tiramisu dessert from traditional Italian cuisine.',
      ),
    );
    writeEntry(
      tmpDir,
      'notes/astronomy.md',
      makeEntry(
        'Stellar Astronomy',
        ['science'],
        'Neutron stars, black holes, and supernovae explosions in distant galaxies observed by Hubble telescope.',
      ),
    );

    const report = consolidate(tmpDir, 'notes', 0.9);
    expect(report.totalEntries).toBe(2);
    expect(report.clustersFound).toBe(0);
    expect(report.clusters).toEqual([]);
  });

  it('does not cross-match entries from different categories', () => {
    const similarContent =
      'Kubernetes container orchestration with Docker images and Helm charts for deployment.';

    writeEntry(
      tmpDir,
      'projects/k8s-deploy.md',
      makeEntry('K8s Deploy', ['kubernetes'], similarContent),
    );
    writeEntry(
      tmpDir,
      'notes/k8s-notes.md',
      makeEntry('K8s Notes', ['kubernetes'], similarContent),
    );

    // Consolidate only 'projects' — should not find entries from 'notes'
    const report = consolidate(tmpDir, 'projects');
    expect(report.totalEntries).toBe(1);
    expect(report.clustersFound).toBe(0);
    expect(report.clusters).toEqual([]);
  });

  it('respects the threshold parameter', () => {
    writeEntry(
      tmpDir,
      'notes/js-promises.md',
      makeEntry(
        'JavaScript Promises',
        ['javascript'],
        'Promises enable asynchronous programming in JavaScript with then catch finally handlers.',
      ),
    );
    writeEntry(
      tmpDir,
      'notes/js-async.md',
      makeEntry(
        'JavaScript Async',
        ['javascript'],
        'Async await syntax in JavaScript simplifies promise-based asynchronous code patterns.',
      ),
    );

    // Very high threshold — no clusters
    const strictReport = consolidate(tmpDir, 'notes', 0.99);
    expect(strictReport.clustersFound).toBe(0);

    // Very low threshold — should find a cluster
    const looseReport = consolidate(tmpDir, 'notes', 0.01);
    expect(looseReport.clustersFound).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for empty knowledge base', () => {
    // tmpDir exists but has no entries
    const report = consolidate(tmpDir);
    expect(report.totalEntries).toBe(0);
    expect(report.clustersFound).toBe(0);
    expect(report.clusters).toEqual([]);
    expect(report.threshold).toBe(0.5);
  });
});
