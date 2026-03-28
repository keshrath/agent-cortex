import fs from 'fs';
import path from 'path';
import { getConfig } from '../types.js';
import { getAvailableAdapters } from './adapters/index.js';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface SessionEntry {
  type?: string;
  role?: string; // Cursor Composer uses `role` instead of `type`
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
  // Dispatch virtual descriptors to the appropriate adapter
  for (const adapter of getAvailableAdapters()) {
    if (filePath.startsWith(`${adapter.prefix}://`)) {
      return adapter.parseSession(filePath);
    }
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const lines = raw.split('\n').filter((l) => l.trim());
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
    // Support both `type` (Claude Code) and `role` (Cursor Composer) fields
    const entryType = entry.type ?? entry.role;

    if (entryType === 'user' && entry.message?.content) {
      // Handle both string content and array of {type:"text", text:"..."} objects
      let content: string;
      if (typeof entry.message.content === 'string') {
        content = entry.message.content;
      } else if (Array.isArray(entry.message.content)) {
        const textParts = (entry.message.content as unknown[])
          .filter(
            (p: unknown) =>
              typeof p === 'string' ||
              (typeof p === 'object' &&
                p !== null &&
                'type' in p &&
                (p as { type: string }).type === 'text'),
          )
          .map((p: unknown) => (typeof p === 'string' ? p : (p as { text?: string }).text))
          .filter(Boolean);
        content =
          textParts.length > 0 ? textParts.join('\n') : JSON.stringify(entry.message.content);
      } else {
        content = JSON.stringify(entry.message.content);
      }
      messages.push({ role: 'user', content, timestamp: ts });
    } else if (entryType === 'assistant' && entry.message?.content) {
      const parts = Array.isArray(entry.message.content)
        ? entry.message.content
        : [entry.message.content];

      const textParts = parts
        .filter(
          (p: unknown) =>
            typeof p === 'string' ||
            (typeof p === 'object' &&
              p !== null &&
              'type' in p &&
              (p as { type: string }).type === 'text'),
        )
        .map((p: unknown) => (typeof p === 'string' ? p : (p as { text?: string }).text))
        .filter(Boolean);

      if (textParts.length > 0) {
        messages.push({
          role: 'assistant',
          content: textParts.join('\n'),
          timestamp: ts,
        });
      }
    } else if (entryType === 'tool_use' || entryType === 'tool_result') {
      const content =
        typeof entry.content === 'string'
          ? entry.content
          : typeof entry.message?.content === 'string'
            ? entry.message.content
            : null;

      if (content) {
        messages.push({
          role: entryType as 'tool_use' | 'tool_result',
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
  const userMessages = entries.filter((e) => (e.type ?? e.role) === 'user');
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
        : Array.isArray(firstUserMsg)
          ? (
              (firstUserMsg as unknown[])
                .filter(
                  (p: unknown) =>
                    typeof p === 'string' ||
                    (typeof p === 'object' &&
                      p !== null &&
                      'type' in p &&
                      (p as { type: string }).type === 'text'),
                )
                .map((p: unknown) => (typeof p === 'string' ? p : (p as { text?: string }).text))
                .filter(Boolean)
                .join('\n') || 'N/A'
            ).substring(0, 200)
          : 'N/A',
  };
}

// ── Discovery ───────────────────────────────────────────────────────────────

/**
 * Discover all session directories under the primary session root and any extra session roots.
 *
 * Extra roots are scanned as follows:
 * - Cursor-style roots (containing `<workspace>/agent-transcripts/`):
 *   Each workspace with an `agent-transcripts/` subdirectory becomes a project
 *   named `cursor-<workspace>`.
 * - Generic roots with subdirectories containing JSONL files:
 *   Each subdirectory becomes a project named `ext-<dirname>`.
 * - Flat roots containing JSONL files directly:
 *   The root itself becomes a single project named after the decoded directory.
 */

/**
 * Decode a Claude Code style project directory name into a human-readable name.
 * e.g. "C--Users-john--my-project" → "my-project"
 *      "C--home-john--repos--app" → "repos/app"
 *      "C--Users-john" → "~"
 * Falls back to the raw name if it doesn't match the expected pattern.
 */
function decodeProjectDirName(dirName: string): string {
  const parts = dirName.split('--');
  if (parts.length < 2) return dirName;

  if (!/^[A-Z]$/i.test(parts[0])) return dirName;

  const homeIdx = parts.findIndex((p) => /^(users|home)-/i.test(p));

  if (homeIdx >= 0 && homeIdx < parts.length - 1) {
    return parts.slice(homeIdx + 1).join('/');
  }

  if (homeIdx >= 0 && homeIdx === parts.length - 1) {
    return '~';
  }

  return parts[parts.length - 1];
}

export function getProjectDirs(): Array<{ name: string; path: string }> {
  const { sessionsDir, extraSessionRoots } = getConfig();
  const results: Array<{ name: string; path: string }> = [];

  // Primary session root
  if (fs.existsSync(sessionsDir)) {
    for (const d of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
      if (d.isDirectory()) {
        results.push({ name: d.name, path: path.join(sessionsDir, d.name) });
      }
    }
  }

  // Extra session roots
  for (const root of extraSessionRoots) {
    if (!fs.existsSync(root)) continue;

    let subdirs: fs.Dirent[];
    try {
      subdirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      continue;
    }

    let addedAny = false;
    for (const d of subdirs) {
      const transcriptsDir = path.join(root, d.name, 'agent-transcripts');
      if (fs.existsSync(transcriptsDir)) {
        results.push({
          name: `cursor-${d.name}`,
          path: transcriptsDir,
        });
        addedAny = true;
        continue;
      }

      // Generic subdirectory: check if it contains JSONL files directly
      const subPath = path.join(root, d.name);
      try {
        const hasJsonl = fs.readdirSync(subPath).some((f) => f.endsWith('.jsonl'));
        if (hasJsonl) {
          results.push({
            name: decodeProjectDirName(d.name),
            path: subPath,
          });
          addedAny = true;
        }
      } catch {
        // skip unreadable dirs
      }
    }

    // Flat root: if no subdirectories matched, check if the root itself has JSONL files
    if (!addedAny) {
      try {
        const hasJsonl = fs.readdirSync(root).some((f) => f.endsWith('.jsonl'));
        if (hasJsonl) {
          results.push({
            name: decodeProjectDirName(path.basename(root)),
            path: root,
          });
        }
      } catch {
        // skip
      }
    }
  }

  // Discover sessions from additional adapters (OpenCode, Cline, Continue.dev, Aider)
  for (const adapter of getAvailableAdapters()) {
    try {
      results.push(...adapter.discoverProjects());
    } catch {
      // skip failed adapters silently
    }
  }

  return results;
}

/**
 * List all .jsonl session files in a given project directory.
 */
export function getSessionFiles(projectPath: string): Array<{ id: string; file: string }> {
  // Dispatch virtual descriptors to the appropriate adapter
  for (const adapter of getAvailableAdapters()) {
    if (projectPath.startsWith(`${adapter.prefix}://`)) {
      return adapter.listSessions(projectPath);
    }
  }

  if (!fs.existsSync(projectPath)) return [];

  return fs
    .readdirSync(projectPath)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({
      id: f.replace('.jsonl', ''),
      file: path.join(projectPath, f),
    }));
}
