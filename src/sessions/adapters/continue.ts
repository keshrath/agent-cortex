import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { SessionEntry } from '../parser.js';
import type { SessionAdapter } from './index.js';

const PREFIX = 'continue://';

function getSessionsDir(): string {
  return join(homedir(), '.continue', 'sessions');
}

export const continueAdapter: SessionAdapter = {
  prefix: 'continue',
  name: 'Continue.dev',

  isAvailable() {
    return existsSync(getSessionsDir());
  },

  discoverProjects() {
    // Group sessions by workspaceDirectory, or return single project
    return [{ name: 'continue', path: `${PREFIX}sessions` }];
  },

  listSessions() {
    const dir = getSessionsDir();
    if (!existsSync(dir)) return [];
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({
          id: f.replace('.json', ''),
          file: `${PREFIX}session:${join(dir, f)}`,
        }));
    } catch {
      return [];
    }
  },

  parseSession(descriptor: string): SessionEntry[] {
    const filePath = descriptor.replace(`${PREFIX}session:`, '');
    if (!existsSync(filePath)) return [];

    try {
      const session = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (!session.history || !Array.isArray(session.history)) return [];

      return session.history
        .filter(
          (h: Record<string, unknown>) =>
            h.message &&
            ((h.message as Record<string, unknown>).role === 'user' ||
              (h.message as Record<string, unknown>).role === 'assistant'),
        )
        .map((h: Record<string, unknown>) => {
          let content = '';
          const msg = h.message as Record<string, unknown>;
          if (typeof msg.content === 'string') {
            content = msg.content;
          } else if (Array.isArray(msg.content)) {
            content = (msg.content as Array<unknown>)
              .filter(
                (p: unknown) =>
                  typeof p === 'string' ||
                  (typeof p === 'object' &&
                    p !== null &&
                    (p as Record<string, unknown>).type === 'text'),
              )
              .map((p: unknown) =>
                typeof p === 'string' ? p : ((p as Record<string, unknown>).text as string) || '',
              )
              .join('\n');
          }
          return {
            type: msg.role as string,
            sessionId: session.sessionId,
            message: { role: msg.role as string, content },
          } as SessionEntry;
        })
        .filter((e: SessionEntry) => e.message?.content);
    } catch {
      return [];
    }
  },
};
