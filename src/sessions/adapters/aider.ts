import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';
import type { SessionEntry } from '../parser.js';
import type { SessionAdapter } from './index.js';

const PREFIX = 'aider://';
const HISTORY_FILE = '.aider.chat.history.md';
const LLM_HISTORY_FILE = '.aider.llm.history';

function findAiderProjects(): string[] {
  // Scan common development directories for aider history files
  const home = homedir();
  const candidates = [
    join(home, 'projects'),
    join(home, 'code'),
    join(home, 'dev'),
    join(home, 'src'),
    join(home, 'repos'),
    join(home, 'workspace'),
  ];

  const found: string[] = [];
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const projectDir = join(dir, entry.name);
        if (
          existsSync(join(projectDir, HISTORY_FILE)) ||
          existsSync(join(projectDir, LLM_HISTORY_FILE))
        ) {
          found.push(projectDir);
        }
      }
    } catch {
      // skip
    }
  }
  return found;
}

export const aiderAdapter: SessionAdapter = {
  prefix: 'aider',
  name: 'Aider',

  isAvailable() {
    return findAiderProjects().length > 0;
  },

  discoverProjects() {
    return findAiderProjects().map((dir) => ({
      name: `aider-${basename(dir)}`,
      path: `${PREFIX}project:${dir}`,
    }));
  },

  listSessions(projectDescriptor: string) {
    const dir = projectDescriptor.replace(`${PREFIX}project:`, '');
    const sessions: Array<{ id: string; file: string }> = [];

    const mdPath = join(dir, HISTORY_FILE);
    if (existsSync(mdPath)) {
      sessions.push({ id: 'chat-history', file: `${PREFIX}md:${mdPath}` });
    }

    const jsonlPath = join(dir, LLM_HISTORY_FILE);
    if (existsSync(jsonlPath)) {
      sessions.push({ id: 'llm-history', file: `${PREFIX}jsonl:${jsonlPath}` });
    }

    return sessions;
  },

  parseSession(descriptor: string): SessionEntry[] {
    if (descriptor.startsWith(`${PREFIX}md:`)) {
      return parseAiderMarkdown(descriptor.replace(`${PREFIX}md:`, ''));
    }
    if (descriptor.startsWith(`${PREFIX}jsonl:`)) {
      return parseAiderJsonl(descriptor.replace(`${PREFIX}jsonl:`, ''));
    }
    return [];
  },
};

function parseAiderMarkdown(filePath: string): SessionEntry[] {
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const entries: SessionEntry[] = [];
    // Aider markdown uses #### headings for user messages, rest is assistant
    const sections = raw.split(/^####\s+/m);
    for (const section of sections) {
      if (!section.trim()) continue;
      const lines = section.split('\n');
      const firstLine = lines[0]?.trim();
      if (!firstLine) continue;

      // First line after #### is the user message
      entries.push({
        type: 'user',
        message: { role: 'user', content: firstLine },
      });

      // Rest is assistant response
      const response = lines.slice(1).join('\n').trim();
      if (response) {
        entries.push({
          type: 'assistant',
          message: { role: 'assistant', content: response },
        });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function parseAiderJsonl(filePath: string): SessionEntry[] {
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const entries: SessionEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.role === 'user' || msg.role === 'assistant') {
          entries.push({
            type: msg.role,
            message: {
              role: msg.role,
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            },
          });
        }
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}
