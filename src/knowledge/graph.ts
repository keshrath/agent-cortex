/**
 * Knowledge Graph Layer — manages typed edges between knowledge entries.
 *
 * Stores edges in the same SQLite database as the vector store, with
 * BFS traversal for multi-hop graph queries.
 */

import { join, dirname } from 'path';
import { mkdirSync } from 'fs';
import { createRequire } from 'module';
import { getConfig } from '../types.js';

import type DatabaseConstructor from 'better-sqlite3';

const require = createRequire(import.meta.url);
type Database = InstanceType<typeof DatabaseConstructor>;

export const RELATIONSHIP_TYPES = [
  'related_to',
  'supersedes',
  'depends_on',
  'contradicts',
  'specializes',
  'part_of',
  'alternative_to',
  'builds_on',
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export interface Edge {
  source: string;
  target: string;
  rel_type: RelationshipType;
  strength: number;
  created_at: string;
}

export interface GraphNode {
  path: string;
  depth: number;
}

export interface GraphResult {
  nodes: GraphNode[];
  edges: Edge[];
}

/**
 * Knowledge graph backed by SQLite.
 * Lazily initializes the database on first access.
 */
export class KnowledgeGraph {
  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath?: string) {
    // Use a separate lightweight DB — NOT the 544MB vector store
    this.dbPath = dbPath ?? join(getConfig().dataDir, 'knowledge-scores.db');
  }

  private init(): void {
    if (this.initialized) return;

    try {
      if (!this.db) {
        mkdirSync(dirname(this.dbPath), { recursive: true });
        const BetterSqlite3 = require('better-sqlite3') as typeof DatabaseConstructor;
        this.db = new BetterSqlite3(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
      }

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS edges (
          source TEXT NOT NULL,
          target TEXT NOT NULL,
          rel_type TEXT NOT NULL,
          strength REAL DEFAULT 0.5,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (source, target, rel_type)
        );
        CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
      `);

      this.initialized = true;
    } catch (err) {
      console.error(`[knowledge] Failed to initialize graph: ${err}`);
      throw err;
    }
  }

  /**
   * Create or update an edge between two entries.
   */
  link(source: string, target: string, relType: RelationshipType, strength: number = 0.5): Edge {
    this.init();
    if (!this.db) throw new Error('Graph database not available');

    if (!RELATIONSHIP_TYPES.includes(relType)) {
      throw new Error(
        `Invalid relationship type: ${relType}. Must be one of: ${RELATIONSHIP_TYPES.join(', ')}`,
      );
    }
    if (strength < 0 || strength > 1) {
      throw new Error('Strength must be between 0 and 1');
    }
    if (source === target) {
      throw new Error('Cannot create self-referencing edge');
    }

    this.db
      .prepare(
        `INSERT INTO edges (source, target, rel_type, strength)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(source, target, rel_type)
         DO UPDATE SET strength = excluded.strength`,
      )
      .run(source, target, relType, strength);

    const row = this.db
      .prepare('SELECT * FROM edges WHERE source = ? AND target = ? AND rel_type = ?')
      .get(source, target, relType) as Edge;

    return row;
  }

  /**
   * Remove edge(s) between two entries.
   * If relType is omitted, removes all edges between source and target.
   */
  unlink(source: string, target: string, relType?: RelationshipType): number {
    this.init();
    if (!this.db) throw new Error('Graph database not available');

    if (relType) {
      const result = this.db
        .prepare('DELETE FROM edges WHERE source = ? AND target = ? AND rel_type = ?')
        .run(source, target, relType);
      return result.changes;
    }

    const result = this.db
      .prepare('DELETE FROM edges WHERE source = ? AND target = ?')
      .run(source, target);
    return result.changes;
  }

  /**
   * List edges, optionally filtered by entry path and/or relationship type.
   */
  links(entry?: string, relType?: RelationshipType): Edge[] {
    this.init();
    if (!this.db) return [];

    if (entry && relType) {
      return this.db
        .prepare(
          `SELECT * FROM edges
           WHERE (source = ? OR target = ?) AND rel_type = ?
           ORDER BY created_at DESC`,
        )
        .all(entry, entry, relType) as Edge[];
    }

    if (entry) {
      return this.db
        .prepare(
          `SELECT * FROM edges
           WHERE source = ? OR target = ?
           ORDER BY created_at DESC`,
        )
        .all(entry, entry) as Edge[];
    }

    if (relType) {
      return this.db
        .prepare('SELECT * FROM edges WHERE rel_type = ? ORDER BY created_at DESC')
        .all(relType) as Edge[];
    }

    return this.db.prepare('SELECT * FROM edges ORDER BY created_at DESC').all() as Edge[];
  }

  /**
   * BFS traversal from a starting entry, returning all nodes and edges
   * within `depth` hops.
   */
  graph(entry: string, depth: number = 2): GraphResult {
    this.init();
    if (!this.db) return { nodes: [], edges: [] };

    const visited = new Map<string, number>(); // path -> depth
    const resultEdges: Edge[] = [];
    const queue: Array<{ path: string; currentDepth: number }> = [{ path: entry, currentDepth: 0 }];

    visited.set(entry, 0);

    while (queue.length > 0) {
      const item = queue.shift()!;
      if (item.currentDepth >= depth) continue;

      const edges = this.db
        .prepare('SELECT * FROM edges WHERE source = ? OR target = ?')
        .all(item.path, item.path) as Edge[];

      for (const edge of edges) {
        const isDuplicate = resultEdges.some(
          (e) =>
            e.source === edge.source && e.target === edge.target && e.rel_type === edge.rel_type,
        );
        if (!isDuplicate) {
          resultEdges.push(edge);
        }

        const neighbor = edge.source === item.path ? edge.target : edge.source;
        if (!visited.has(neighbor)) {
          const neighborDepth = item.currentDepth + 1;
          visited.set(neighbor, neighborDepth);
          queue.push({ path: neighbor, currentDepth: neighborDepth });
        }
      }
    }

    const nodes: GraphNode[] = Array.from(visited.entries()).map(([p, d]) => ({
      path: p,
      depth: d,
    }));

    return { nodes, edges: resultEdges };
  }

  /**
   * Get 1-hop connected entries for a given entry path.
   */
  getRelated(entry: string): Array<{ path: string; rel_type: string; strength: number }> {
    this.init();
    if (!this.db) return [];

    const edges = this.db
      .prepare('SELECT * FROM edges WHERE source = ? OR target = ?')
      .all(entry, entry) as Edge[];

    return edges.map((e) => ({
      path: e.source === entry ? e.target : e.source,
      rel_type: e.rel_type,
      strength: e.strength,
    }));
  }

  /** Close the database connection. */
  close(): void {
    try {
      this.db?.close();
    } catch (err) {
      console.error(`[knowledge] Failed to close graph DB: ${err}`);
    } finally {
      this.db = null;
      this.initialized = false;
    }
  }
}

// ── Singleton instance ───────────────────────────────────────────────────────

let _graphInstance: KnowledgeGraph | null = null;

export function getKnowledgeGraph(dbPath?: string): KnowledgeGraph {
  if (!_graphInstance) {
    _graphInstance = new KnowledgeGraph(dbPath);
  }
  return _graphInstance;
}
