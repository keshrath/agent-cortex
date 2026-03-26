import fs from 'fs';
import path from 'path';
import { getConfig } from '../types.js';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface SessionEntry {
  type: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  message?: { role?: string; content: unknown };
  content?: string;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  timestamp: string | null;
}

export interface SessionMeta {
  startTime: string;
  endTime: string;
  cwd: string;
  branch: string;
  messageCount: number;
  userMessageCount: number;
  preview: string;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Parse a JSONL session file into an array of entries.
 * Malformed lines are silently skipped.
 */
export function parseSessionFile(filePath: string): SessionEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const lines = raw.split('\n').filter(l => l.trim());
  const entries: SessionEntry[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed lines gracefully
    }
  }

  return entries;
}

/**
 * Extract structured messages from raw session entries.
 *
 * - User messages: entry.message.content (string or stringified)
 * - Assistant messages: text parts from content array
 * - Tool use / result: content truncated to 500 chars
 */
export function extractMessages(entries: SessionEntry[]): SessionMessage[] {
  const messages: SessionMessage[] = [];

  for (const entry of entries) {
    const ts = entry.timestamp ?? null;

    if (entry.type === 'user' && entry.message?.content) {
      const content =
        typeof entry.message.content === 'string'
          ? entry.message.content
          : JSON.stringify(entry.message.content);
      messages.push({ role: 'user', content, timestamp: ts });
    } else if (entry.type === 'assistant' && entry.message?.content) {
      const parts = Array.isArray(entry.message.content)
        ? entry.message.content
        : [entry.message.content];

      const textParts = parts
        .filter((p: unknown) => typeof p === 'string' || (typeof p === 'object' && p !== null && 'type' in p && (p as {type: string}).type === 'text'))
        .map((p: unknown) => (typeof p === 'string' ? p : (p as {text?: string}).text))
        .filter(Boolean);

      if (textParts.length > 0) {
        messages.push({
          role: 'assistant',
          content: textParts.join('\n'),
          timestamp: ts,
        });
      }
    } else if (entry.type === 'tool_use' || entry.type === 'tool_result') {
      const content =
        typeof entry.content === 'string'
          ? entry.content
          : typeof entry.message?.content === 'string'
            ? entry.message.content
            : null;

      if (content) {
        messages.push({
          role: entry.type as 'tool_use' | 'tool_result',
          content: content.substring(0, 500),
          timestamp: ts,
        });
      }
    }
  }

  return messages;
}

/**
 * Extract metadata from session entries (first/last entry, counts, preview).
 */
export function getSessionMeta(entries: SessionEntry[]): SessionMeta {
  if (entries.length === 0) {
    return {
      startTime: 'unknown',
      endTime: 'unknown',
      cwd: 'unknown',
      branch: 'unknown',
      messageCount: 0,
      userMessageCount: 0,
      preview: 'N/A',
    };
  }

  const first = entries[0];
  const last = entries[entries.length - 1];
  const userMessages = entries.filter(e => e.type === 'user');
  const firstUserMsg = userMessages[0]?.message?.content;

  return {
    startTime: first?.timestamp ?? 'unknown',
    endTime: last?.timestamp ?? 'unknown',
    cwd: first?.cwd ?? 'unknown',
    branch: first?.gitBranch ?? 'unknown',
    messageCount: entries.length,
    userMessageCount: userMessages.length,
    preview:
      typeof firstUserMsg === 'string'
        ? firstUserMsg.substring(0, 200)
        : 'N/A',
  };
}

// ── Discovery ───────────────────────────────────────────────────────────────

/**
 * Discover all project directories under ~/.claude/projects/
 */
export function getProjectDirs(): Array<{ name: string; path: string }> {
  const { projectsDir } = getConfig();
  if (!fs.existsSync(projectsDir)) return [];

  return fs
    .readdirSync(projectsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({
      name: d.name,
      path: path.join(projectsDir, d.name),
    }));
}

/**
 * List all .jsonl session files in a given project directory.
 */
export function getSessionFiles(
  projectPath: string,
): Array<{ id: string; file: string }> {
  if (!fs.existsSync(projectPath)) return [];

  return fs
    .readdirSync(projectPath)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      id: f.replace('.jsonl', ''),
      file: path.join(projectPath, f),
    }));
}
