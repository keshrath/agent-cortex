/**
 * SQLite-backed vector store using better-sqlite3 and sqlite-vec
 * for semantic similarity search over knowledge and session embeddings.
 */

import { join } from 'path';
import { statSync } from 'fs';
import { createRequire } from 'module';
import { getConfig } from '../types.js';

import type DatabaseConstructor from 'better-sqlite3';

const require = createRequire(import.meta.url);
type Database = InstanceType<typeof DatabaseConstructor>;

/** A single embedding entry to store. */
export interface VectorEntry {
  id: string;
  source: 'knowledge' | 'session';
  sourceId: string;
  chunkIndex: number;
  chunkText: string;
  provider: string;
  dimensions: number;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

/** A search result with similarity score. */
export interface VectorSearchResult {
  id: string;
  sourceId: string;
  source: 'knowledge' | 'session';
  chunkText: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/** Aggregate statistics about the vector store. */
export interface VectorStoreStats {
  totalEntries: number;
  knowledgeEntries: number;
  sessionEntries: number;
  dbSizeMB: number;
  provider: string | null;
  dimensions: number | null;
}

/** Convert a number[] to a Float32Array buffer for BLOB storage. */
function toFloat32Buffer(vec: number[]): Buffer {
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer);
}

/**
 * SQLite + sqlite-vec vector store for semantic search.
 *
 * Lazily initializes the database on first access. Stores embeddings as
 * Float32 BLOBs and uses sqlite-vec's vec0 virtual table for cosine
 * similarity search.
 */
export class VectorStore {
  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;
  private vecAvailable = false;
  private currentDimensions: number | null = null;

  /**
   * Create a VectorStore instance.
   * @param dbPath - Path to the SQLite database file. Defaults to `{claudeDir}/knowledge-vectors.db`.
   */
  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? join(getConfig().claudeDir, 'knowledge-vectors.db');
  }

  /**
   * Initialize the database: create tables, load sqlite-vec extension.
   * Called lazily on first operation that needs the DB.
   */
  private init(dimensions: number): void {
    if (this.initialized && this.currentDimensions === dimensions) return;

    try {
      if (!this.db) {
        const BetterSqlite3 = require('better-sqlite3') as typeof DatabaseConstructor;
        this.db = new BetterSqlite3(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
      }

      this.loadVecExtension();

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS embeddings (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL CHECK(source IN ('knowledge','session')),
          source_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          chunk_text TEXT NOT NULL,
          provider TEXT NOT NULL,
          dimensions INTEGER NOT NULL,
          embedding BLOB NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          metadata TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_emb_source ON embeddings(source, source_id);
        CREATE INDEX IF NOT EXISTS idx_emb_provider ON embeddings(provider);

        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      if (this.vecAvailable) {
        this.ensureVecTable(dimensions);
      }

      this.currentDimensions = dimensions;
      this.initialized = true;
    } catch (err) {
      console.error(`[knowledge] Failed to initialize vector store: ${err}`);
      throw err;
    }
  }

  /** Attempt to load the sqlite-vec extension. */
  private loadVecExtension(): void {
    if (!this.db) return;

    try {
      const sqliteVec = require('sqlite-vec') as { load: (db: Database) => void };
      sqliteVec.load(this.db);
      this.vecAvailable = true;
    } catch (err) {
      console.error(
        `[knowledge] sqlite-vec extension not available, vector search disabled: ${err}`,
      );
      this.vecAvailable = false;
    }
  }

  /** Create or verify the vec0 virtual table matches the expected dimensions. */
  private ensureVecTable(dimensions: number): void {
    if (!this.db || !this.vecAvailable) return;

    try {
      const existing = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_idx'")
        .get() as { name: string } | undefined;

      if (existing) {
        const storedDims = this.getMetaValue('dimensions');
        if (storedDims && parseInt(storedDims, 10) === dimensions) {
          return;
        }
        this.db.exec('DROP TABLE IF EXISTS vec_idx');
      }

      this.db.exec(
        `CREATE VIRTUAL TABLE vec_idx USING vec0(id TEXT PRIMARY KEY, embedding float[${dimensions}])`,
      );
      this.setMetaValue('dimensions', String(dimensions));
    } catch (err) {
      console.error(`[knowledge] Failed to create vec0 table: ${err}`);
      this.vecAvailable = false;
    }
  }

  /** Get a value from the meta table. */
  private getMetaValue(key: string): string | null {
    if (!this.db) return null;
    try {
      const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
        | { value: string }
        | undefined;
      return row?.value ?? null;
    } catch {
      return null;
    }
  }

  /** Set a value in the meta table. */
  private setMetaValue(key: string, value: string): void {
    if (!this.db) return;
    try {
      this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
    } catch (err) {
      console.error(`[knowledge] Failed to set meta value ${key}: ${err}`);
    }
  }

  /** Ensure DB is initialized, using dimensions from the first entry or the stored value. */
  private ensureInit(dimensions?: number): void {
    const dims = dimensions ?? this.currentDimensions ?? this.getStoredDimensions();
    if (dims === null) {
      throw new Error('[knowledge] Cannot initialize vector store without known dimensions');
    }
    this.init(dims);
  }

  /** Read stored dimensions from meta (requires db to exist). */
  private getStoredDimensions(): number | null {
    if (this.db) {
      const val = this.getMetaValue('dimensions');
      return val ? parseInt(val, 10) : null;
    }
    try {
      const BetterSqlite3 = require('better-sqlite3') as typeof DatabaseConstructor;
      const tmpDb = new BetterSqlite3(this.dbPath, { readonly: true });
      try {
        const row = tmpDb.prepare("SELECT value FROM meta WHERE key = 'dimensions'").get() as
          | { value: string }
          | undefined;
        return row ? parseInt(row.value, 10) : null;
      } finally {
        tmpDb.close();
      }
    } catch {
      return null;
    }
  }

  /**
   * Store embeddings for a source. Replaces existing chunks for the same source_id.
   * Uses a transaction for atomicity.
   *
   * @param entries - The embedding entries to store
   */
  upsert(entries: VectorEntry[]): void {
    if (entries.length === 0) return;

    try {
      const dims = entries[0].dimensions;
      this.ensureInit(dims);
      if (!this.db) return;

      const insertEmbed = this.db.prepare(`
        INSERT OR REPLACE INTO embeddings
          (id, source, source_id, chunk_index, chunk_text, provider, dimensions, embedding, metadata)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const deleteVec = this.vecAvailable
        ? this.db.prepare('DELETE FROM vec_idx WHERE id = ?')
        : null;

      const insertVec = this.vecAvailable
        ? this.db.prepare('INSERT INTO vec_idx (id, embedding) VALUES (?, ?)')
        : null;

      const deleteBySourceEmbed = this.db.prepare('SELECT id FROM embeddings WHERE source_id = ?');

      const transaction = this.db.transaction((items: VectorEntry[]) => {
        const sourceIds = new Set(items.map((e) => e.sourceId));
        for (const sid of sourceIds) {
          if (deleteVec) {
            const existing = deleteBySourceEmbed.all(sid) as Array<{ id: string }>;
            for (const row of existing) {
              deleteVec.run(row.id);
            }
          }
          this.db!.prepare('DELETE FROM embeddings WHERE source_id = ?').run(sid);
        }

        for (const entry of items) {
          const buf = toFloat32Buffer(entry.embedding);
          insertEmbed.run(
            entry.id,
            entry.source,
            entry.sourceId,
            entry.chunkIndex,
            entry.chunkText,
            entry.provider,
            entry.dimensions,
            buf,
            entry.metadata ? JSON.stringify(entry.metadata) : null,
          );

          if (insertVec) {
            insertVec.run(entry.id, buf);
          }
        }
      });

      transaction(entries);
    } catch (err) {
      console.error(`[knowledge] Vector upsert failed: ${err}`);
    }
  }

  /**
   * Search by vector similarity. Returns top-k nearest neighbors.
   *
   * @param queryVector - The query embedding vector
   * @param maxResults - Maximum number of results (default 10)
   * @returns Sorted results with cosine similarity scores
   */
  search(queryVector: number[], maxResults: number = 10): VectorSearchResult[] {
    return this.searchInternal(queryVector, maxResults);
  }

  /**
   * Search filtered by source type (knowledge or session).
   *
   * @param queryVector - The query embedding vector
   * @param source - Filter to 'knowledge' or 'session' entries only
   * @param maxResults - Maximum number of results (default 10)
   * @returns Sorted results with cosine similarity scores
   */
  searchBySource(
    queryVector: number[],
    source: 'knowledge' | 'session',
    maxResults: number = 10,
  ): VectorSearchResult[] {
    return this.searchInternal(queryVector, maxResults, source);
  }

  /** Internal search implementation with optional source filter. */
  private searchInternal(
    queryVector: number[],
    maxResults: number,
    source?: 'knowledge' | 'session',
  ): VectorSearchResult[] {
    try {
      this.ensureInit(queryVector.length);
    } catch {
      return [];
    }

    if (!this.db) return [];

    if (!this.vecAvailable) {
      console.error('[knowledge] Vector search unavailable — sqlite-vec not loaded');
      return [];
    }

    try {
      const queryBuf = toFloat32Buffer(queryVector);

      const fetchLimit = source ? maxResults * 3 : maxResults;

      const rows = this.db
        .prepare(
          `SELECT v.id, v.distance
           FROM vec_idx v
           WHERE v.embedding MATCH ?
           ORDER BY v.distance
           LIMIT ?`,
        )
        .all(queryBuf, fetchLimit) as Array<{ id: string; distance: number }>;

      if (rows.length === 0) return [];

      const idPlaceholders = rows.map(() => '?').join(',');
      const embeddingRows = this.db
        .prepare(
          `SELECT id, source, source_id, chunk_text, metadata
           FROM embeddings
           WHERE id IN (${idPlaceholders})`,
        )
        .all(...rows.map((r) => r.id)) as Array<{
        id: string;
        source: 'knowledge' | 'session';
        source_id: string;
        chunk_text: string;
        metadata: string | null;
      }>;

      const embMap = new Map(embeddingRows.map((r) => [r.id, r]));

      const results: VectorSearchResult[] = [];
      for (const row of rows) {
        const emb = embMap.get(row.id);
        if (!emb) continue;
        if (source && emb.source !== source) continue;

        results.push({
          id: row.id,
          sourceId: emb.source_id,
          source: emb.source,
          chunkText: emb.chunk_text,
          score: 1 - row.distance,
          metadata: emb.metadata ? JSON.parse(emb.metadata) : undefined,
        });

        if (results.length >= maxResults) break;
      }

      return results;
    } catch (err) {
      console.error(`[knowledge] Vector search failed: ${err}`);
      return [];
    }
  }

  /**
   * Delete all embeddings for a given source_id.
   *
   * @param sourceId - The source identifier to remove
   */
  deleteBySource(sourceId: string): void {
    try {
      this.ensureInit();
    } catch {
      return;
    }
    if (!this.db) return;

    try {
      const ids = this.db
        .prepare('SELECT id FROM embeddings WHERE source_id = ?')
        .all(sourceId) as Array<{ id: string }>;

      if (ids.length === 0) return;

      const transaction = this.db.transaction(() => {
        if (this.vecAvailable) {
          const deleteVec = this.db!.prepare('DELETE FROM vec_idx WHERE id = ?');
          for (const row of ids) {
            deleteVec.run(row.id);
          }
        }
        this.db!.prepare('DELETE FROM embeddings WHERE source_id = ?').run(sourceId);
      });

      transaction();
    } catch (err) {
      console.error(`[knowledge] Delete by source failed: ${err}`);
    }
  }

  /**
   * Check whether a source_id has any stored embeddings.
   *
   * @param sourceId - The source identifier to check
   * @returns True if at least one embedding exists for this source
   */
  hasEmbeddings(sourceId: string): boolean {
    try {
      this.ensureInit();
    } catch {
      return false;
    }
    if (!this.db) return false;

    try {
      const row = this.db
        .prepare('SELECT 1 FROM embeddings WHERE source_id = ? LIMIT 1')
        .get(sourceId) as Record<string, unknown> | undefined;
      return row !== undefined;
    } catch (err) {
      console.error(`[knowledge] hasEmbeddings check failed: ${err}`);
      return false;
    }
  }

  /**
   * Get the name of the currently active embedding provider.
   *
   * @returns The provider name, or null if none is set
   */
  getCurrentProvider(): string | null {
    try {
      this.ensureInit();
    } catch {
      return null;
    }
    return this.getMetaValue('provider');
  }

  /**
   * Set the active embedding provider. If the provider has changed since
   * the last call, all existing embeddings are wiped to avoid mixing
   * incompatible vector spaces.
   *
   * @param providerName - The provider name (e.g. "openai", "ollama")
   * @param dimensions - The embedding dimensions for this provider
   * @returns True if a wipe was performed (provider changed)
   */
  setProvider(providerName: string, dimensions: number): boolean {
    this.init(dimensions);
    if (!this.db) return false;

    const current = this.getMetaValue('provider');
    if (current && current !== providerName) {
      this.wipe();
      this.initialized = false;
      this.init(dimensions);
      this.setMetaValue('provider', providerName);
      this.setMetaValue('dimensions', String(dimensions));
      return true;
    }

    if (!current) {
      this.setMetaValue('provider', providerName);
    }
    return false;
  }

  /**
   * Wipe all embeddings and the vec0 index.
   * Used when switching embedding providers to avoid mixing vector spaces.
   */
  wipe(): void {
    try {
      this.ensureInit();
    } catch {
      return;
    }
    if (!this.db) return;

    try {
      this.db.exec('DELETE FROM embeddings');
      if (this.vecAvailable) {
        this.db.exec('DROP TABLE IF EXISTS vec_idx');
      }
      this.db.exec("DELETE FROM meta WHERE key = 'dimensions'");
      this.currentDimensions = null;
    } catch (err) {
      console.error(`[knowledge] Wipe failed: ${err}`);
    }
  }

  /**
   * Get statistics about the vector store.
   *
   * @returns Counts by source type, DB file size, provider, and dimensions
   */
  stats(): VectorStoreStats {
    const empty: VectorStoreStats = {
      totalEntries: 0,
      knowledgeEntries: 0,
      sessionEntries: 0,
      dbSizeMB: 0,
      provider: null,
      dimensions: null,
    };

    try {
      this.ensureInit();
    } catch {
      // If init fails (no dimensions yet), try opening DB directly for stats
      try {
        if (!this.db) {
          const BetterSqlite3 = require('better-sqlite3') as typeof DatabaseConstructor;
          this.db = new BetterSqlite3(this.dbPath);
          this.db.pragma('journal_mode = WAL');
        }
      } catch {
        return empty;
      }
    }
    if (!this.db) return empty;

    try {
      const total = this.db.prepare('SELECT COUNT(*) as count FROM embeddings').get() as {
        count: number;
      };

      const knowledge = this.db
        .prepare("SELECT COUNT(*) as count FROM embeddings WHERE source = 'knowledge'")
        .get() as { count: number };

      const session = this.db
        .prepare("SELECT COUNT(*) as count FROM embeddings WHERE source = 'session'")
        .get() as { count: number };

      let dbSizeMB = 0;
      try {
        const stat = statSync(this.dbPath);
        dbSizeMB = Math.round((stat.size / (1024 * 1024)) * 100) / 100;
      } catch {
        /* empty — file may not exist yet */
      }

      const provider = this.getMetaValue('provider');
      const dimStr = this.getMetaValue('dimensions');

      return {
        totalEntries: total.count,
        knowledgeEntries: knowledge.count,
        sessionEntries: session.count,
        dbSizeMB,
        provider,
        dimensions: dimStr ? parseInt(dimStr, 10) : null,
      };
    } catch (err) {
      console.error(`[knowledge] Stats query failed: ${err}`);
      return empty;
    }
  }

  /** Close the database connection and release resources. */
  close(): void {
    try {
      this.db?.close();
    } catch (err) {
      console.error(`[knowledge] Failed to close vector store: ${err}`);
    } finally {
      this.db = null;
      this.initialized = false;
      this.currentDimensions = null;
    }
  }
}
