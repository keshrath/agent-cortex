import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { SessionEntry } from '../parser.js';
import type { SessionAdapter } from './index.js';

const PREFIX = 'cline://';

function getTasksDir(): string {
  const platform = process.platform;
  const home = homedir();
  const ext = 'saoudrizwan.claude-dev';
  if (platform === 'win32') {
    return join(
      process.env.APPDATA || join(home, 'AppData', 'Roaming'),
      'Code',
      'User',
      'globalStorage',
      ext,
      'tasks',
    );
  } else if (platform === 'darwin') {
    return join(
      home,
      'Library',
      'Application Support',
      'Code',
      'User',
      'globalStorage',
      ext,
      'tasks',
    );
  }
  return join(home, '.config', 'Code', 'User', 'globalStorage', ext, 'tasks');
}

export const clineAdapter: SessionAdapter = {
  prefix: 'cline',
  name: 'Cline',

  isAvailable() {
    return existsSync(getTasksDir());
  },

  discoverProjects() {
    return [{ name: 'cline', path: `${PREFIX}tasks` }];
  },

  listSessions(_projectDescriptor: string) {
    const tasksDir = getTasksDir();
    if (!existsSync(tasksDir)) return [];
    try {
      return readdirSync(tasksDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .filter((d) => existsSync(join(tasksDir, d.name, 'api_conversation_history.json')))
        .map((d) => ({ id: d.name, file: `${PREFIX}task:${d.name}` }));
    } catch {
      return [];
    }
  },

  parseSession(descriptor: string): SessionEntry[] {
    const taskId = descriptor.replace(`${PREFIX}task:`, '');
    const filePath = join(getTasksDir(), taskId, 'api_conversation_history.json');
    if (!existsSync(filePath)) return [];

    try {
      const messages = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (!Array.isArray(messages)) return [];

      return messages
        .filter((m: Record<string, unknown>) => m.role === 'user' || m.role === 'assistant')
        .map((m: Record<string, unknown>) => {
          let content = '';
          if (typeof m.content === 'string') {
            content = m.content;
          } else if (Array.isArray(m.content)) {
            content = (m.content as Array<Record<string, unknown>>)
              .filter((p) => p.type === 'text')
              .map((p) => (p.text as string) || '')
              .join('\n');
          }
          return {
            type: m.role as string,
            message: { role: m.role as string, content },
          } as SessionEntry;
        })
        .filter((e: SessionEntry) => e.message?.content);
    } catch {
      return [];
    }
  },
};
