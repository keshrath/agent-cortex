import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { KnowledgeGraph, RELATIONSHIP_TYPES } from '../src/knowledge/graph.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-graph-test-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('KnowledgeGraph', () => {
  let tmpDir: string;
  let dbPath: string;
  let graph: KnowledgeGraph;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    dbPath = path.join(tmpDir, 'test-graph.db');
    graph = new KnowledgeGraph(dbPath);
  });

  afterEach(() => {
    try {
      graph.close();
    } catch {
      /* ignore */
    }
    cleanup(tmpDir);
  });

  describe('link', () => {
    it('creates an edge between two entries', () => {
      const edge = graph.link('projects/a.md', 'projects/b.md', 'related_to');
      expect(edge.source).toBe('projects/a.md');
      expect(edge.target).toBe('projects/b.md');
      expect(edge.rel_type).toBe('related_to');
      expect(edge.strength).toBe(0.5);
    });

    it('updates strength on duplicate edge', () => {
      graph.link('projects/a.md', 'projects/b.md', 'related_to', 0.3);
      const edge = graph.link('projects/a.md', 'projects/b.md', 'related_to', 0.9);
      expect(edge.strength).toBe(0.9);
    });

    it('allows multiple rel types between same entries', () => {
      graph.link('a.md', 'b.md', 'related_to');
      graph.link('a.md', 'b.md', 'depends_on');
      const edges = graph.links('a.md');
      expect(edges.length).toBe(2);
    });

    it('rejects self-referencing edge', () => {
      expect(() => graph.link('a.md', 'a.md', 'related_to')).toThrow('self-referencing');
    });

    it('rejects invalid strength', () => {
      expect(() => graph.link('a.md', 'b.md', 'related_to', 1.5)).toThrow('between 0 and 1');
      expect(() => graph.link('a.md', 'b.md', 'related_to', -0.1)).toThrow('between 0 and 1');
    });

    it('accepts custom strength', () => {
      const edge = graph.link('a.md', 'b.md', 'supersedes', 0.8);
      expect(edge.strength).toBe(0.8);
    });
  });

  describe('unlink', () => {
    it('removes a specific edge', () => {
      graph.link('a.md', 'b.md', 'related_to');
      const removed = graph.unlink('a.md', 'b.md', 'related_to');
      expect(removed).toBe(1);
      expect(graph.links('a.md').length).toBe(0);
    });

    it('removes all edges when rel_type omitted', () => {
      graph.link('a.md', 'b.md', 'related_to');
      graph.link('a.md', 'b.md', 'depends_on');
      const removed = graph.unlink('a.md', 'b.md');
      expect(removed).toBe(2);
    });

    it('returns 0 when no matching edge', () => {
      const removed = graph.unlink('a.md', 'b.md', 'related_to');
      expect(removed).toBe(0);
    });
  });

  describe('links', () => {
    it('returns all edges when no filter', () => {
      graph.link('a.md', 'b.md', 'related_to');
      graph.link('c.md', 'd.md', 'depends_on');
      const edges = graph.links();
      expect(edges.length).toBe(2);
    });

    it('filters by entry', () => {
      graph.link('a.md', 'b.md', 'related_to');
      graph.link('c.md', 'd.md', 'depends_on');
      const edges = graph.links('a.md');
      expect(edges.length).toBe(1);
    });

    it('finds entry as both source and target', () => {
      graph.link('a.md', 'b.md', 'related_to');
      graph.link('c.md', 'a.md', 'depends_on');
      const edges = graph.links('a.md');
      expect(edges.length).toBe(2);
    });

    it('filters by rel_type', () => {
      graph.link('a.md', 'b.md', 'related_to');
      graph.link('a.md', 'c.md', 'depends_on');
      const edges = graph.links(undefined, 'depends_on');
      expect(edges.length).toBe(1);
    });

    it('filters by both entry and rel_type', () => {
      graph.link('a.md', 'b.md', 'related_to');
      graph.link('a.md', 'c.md', 'depends_on');
      graph.link('d.md', 'e.md', 'depends_on');
      const edges = graph.links('a.md', 'depends_on');
      expect(edges.length).toBe(1);
    });
  });

  describe('graph (BFS)', () => {
    it('returns starting node when no edges', () => {
      const result = graph.graph('a.md');
      expect(result.nodes.length).toBe(1);
      expect(result.nodes[0]).toEqual({ path: 'a.md', depth: 0 });
      expect(result.edges.length).toBe(0);
    });

    it('traverses 1 hop', () => {
      graph.link('a.md', 'b.md', 'related_to');
      graph.link('b.md', 'c.md', 'depends_on');
      const result = graph.graph('a.md', 1);
      expect(result.nodes.length).toBe(2);
      expect(result.edges.length).toBe(1);
    });

    it('traverses 2 hops (default)', () => {
      graph.link('a.md', 'b.md', 'related_to');
      graph.link('b.md', 'c.md', 'depends_on');
      graph.link('c.md', 'd.md', 'supersedes');
      const result = graph.graph('a.md');
      expect(result.nodes.length).toBe(3);
      expect(result.edges.length).toBe(2);
    });

    it('does not revisit nodes', () => {
      graph.link('a.md', 'b.md', 'related_to');
      graph.link('b.md', 'a.md', 'depends_on');
      const result = graph.graph('a.md', 3);
      expect(result.nodes.length).toBe(2);
    });

    it('terminates on cycle A→B→C→A', () => {
      graph.link('a.md', 'b.md', 'related_to');
      graph.link('b.md', 'c.md', 'depends_on');
      graph.link('c.md', 'a.md', 'builds_on');
      const result = graph.graph('a.md', 10);
      expect(result.nodes.length).toBe(3);
      expect(result.edges.length).toBe(3);
      const nodePaths = result.nodes.map((n) => n.path).sort();
      expect(nodePaths).toEqual(['a.md', 'b.md', 'c.md']);
    });
  });

  describe('getRelated', () => {
    it('returns 1-hop connected entries', () => {
      graph.link('a.md', 'b.md', 'related_to', 0.8);
      graph.link('c.md', 'a.md', 'depends_on', 0.6);
      const related = graph.getRelated('a.md');
      expect(related.length).toBe(2);
    });

    it('returns empty for unconnected entry', () => {
      const related = graph.getRelated('isolated.md');
      expect(related).toEqual([]);
    });
  });

  describe('RELATIONSHIP_TYPES', () => {
    it('contains all expected types', () => {
      expect(RELATIONSHIP_TYPES.length).toBe(8);
    });
  });
});
