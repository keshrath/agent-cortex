import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';
import type { SessionEntry } from '../parser.js';
import type { SessionAdapter } from './index.js';

const require = createRequire(import.meta.url);

function getDbPath(): string {
  const dataDir = process.env.OPENCODE_DATA_DIR || join(homedir(), '.local', 'share', 'opencode');
  return join(dataDir, 'opencode.db');
}

const PREFIX = 'opencode://';

export const openCodeAdapter: SessionAdapter = {
  prefix: 'opencode',
  name: 'OpenCode',

  isAvailable(): boolean {
    return existsSync(getDbPath());
  },

  discoverProjects() {
    return [{ name: 'opencode', path: `${PREFIX}all` }];
  },

  listSessions(_projectDescriptor: string) {
    const BetterSqlite3 = require('better-sqlite3');
    const db = new BetterSqlite3(getDbPath(), { readonly: true });
    try {
      // Try common table/column names
      const rows = db
        .prepare('SELECT id FROM session ORDER BY updated_at DESC LIMIT 500')
        .all() as Array<{ id: string }>;
      return rows.map((r: { id: string }) => ({ id: r.id, file: `${PREFIX}session:${r.id}` }));
    } catch {
      return [];
    } finally {
      db.close();
    }
  },

  parseSession(descriptor: string): SessionEntry[] {
    const sessionId = descriptor.replace(`${PREFIX}session:`, '');
    const BetterSqlite3 = require('better-sqlite3');
    const db = new BetterSqlite3(getDbPath(), { readonly: true });
    try {
      const rows = db
        .prepare(
          'SELECT id, role, time_created, data FROM message WHERE session_id = ? ORDER BY time_created',
        )
        .all(sessionId) as Array<{
        id: string;
        role: string;
        time_created: string;
        data: string;
      }>;

      const entries: SessionEntry[] = [];
      for (const row of rows) {
        const role = row.role === 'user' ? 'user' : 'assistant';
        let content = '';
        try {
          const data = JSON.parse(row.data);
          // OpenCode stores parts in the data JSON
          if (data.parts && Array.isArray(data.parts)) {
            content = data.parts
              .filter((p: Record<string, unknown>) => p.type === 'text')
              .map((p: Record<string, unknown>) => p.text || p.content || '')
              .join('\n');
          } else if (data.content) {
            content =
              typeof data.content === 'string' ? data.content : JSON.stringify(data.content);
          } else if (data.text) {
            content = data.text;
          }
        } catch {
          content = row.data || '';
        }
        if (content) {
          entries.push({
            type: role,
            timestamp: row.time_created,
            sessionId,
            message: { role, content },
          });
        }
      }
      return entries;
    } catch {
      return [];
    } finally {
      db.close();
    }
  },
};
