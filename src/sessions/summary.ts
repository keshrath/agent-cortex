import {
  getProjectDirs,
  getSessionFiles,
  parseSessionFile,
  extractMessages,
  getSessionMeta,
  type SessionMeta,
} from './parser.js';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface SessionSummary {
  meta: SessionMeta;
  topicCount: number;
  topics: Array<{ timestamp: string | null; content: string }>;
  toolsUsed: string[];
  filesModified: string[];
}

// ── File path extraction ────────────────────────────────────────────────────

/**
 * Regex to match common file paths in tool results.
 * Captures paths like /src/foo.ts, ./bar.js, C:\path\file.py, etc.
 */
const FILE_PATH_RE =
  /(?:^|[\s"'`(])([./~]?(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|vue|svelte|css|scss|html|json|yaml|yml|toml|md|txt|sh|sql|prisma|graphql|proto))\b/g;

function extractFilePaths(text: string): string[] {
  const paths = new Set<string>();
  let match: RegExpExecArray | null;

  // Reset lastIndex
  FILE_PATH_RE.lastIndex = 0;

  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    paths.add(match[1]);
  }

  return Array.from(paths);
}

/**
 * Extract tool names from tool_use entries.
 * The tool name is typically the first word or a JSON "name" field.
 */
const TOOL_NAME_RE = /(?:"name"\s*:\s*"([^"]+)"|^(\w+(?:_\w+)*))/;

function extractToolName(content: string): string | null {
  const match = content.match(TOOL_NAME_RE);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

// ── Session summary ─────────────────────────────────────────────────────────

/**
 * Generate a structured summary of a session.
 *
 * - Extracts user messages as topics (first 300 chars each)
 * - Collects unique tool names from tool_use entries
 * - Extracts file paths mentioned in tool results
 */
export function getSessionSummary(sessionId: string, project?: string): SessionSummary | null {
  const projects = getProjectDirs().filter(
    (p) => !project || p.name.toLowerCase().includes(project.toLowerCase()),
  );

  for (const proj of projects) {
    const sessions = getSessionFiles(proj.path);
    const match = sessions.find((s) => s.id === sessionId);
    if (!match) continue;

    const entries = parseSessionFile(match.file);
    if (entries.length === 0) return null;

    const meta = getSessionMeta(entries);
    const messages = extractMessages(entries);

    // Topics: user messages truncated to 300 chars
    // Filter out tool results, JSON blobs, base64 images, system reminders
    const isHumanMessage = (text: string): boolean => {
      const t = text.trimStart();
      if (t.startsWith('[{') || t.startsWith('{"')) return false;
      if (t.includes('tool_use_id') || t.includes('tool_result')) return false;
      if (t.includes('base64') || t.includes('media_type')) return false;
      if (t.includes('<system-reminder>')) return false;
      if (t.length < 3) return false;
      return true;
    };

    const topics = messages
      .filter((m) => m.role === 'user')
      .filter((m) => isHumanMessage(m.content))
      .map((m) => ({
        timestamp: m.timestamp,
        content: m.content.length > 300 ? m.content.substring(0, 300) + '...' : m.content,
      }));

    // Tools: unique tool names from tool_use messages
    const toolNames = new Set<string>();
    for (const msg of messages) {
      if (msg.role === 'tool_use') {
        const name = extractToolName(msg.content);
        if (name) toolNames.add(name);
      }
    }

    // Files: paths mentioned in tool_result messages
    const allFiles = new Set<string>();
    for (const msg of messages) {
      if (msg.role === 'tool_result') {
        for (const fp of extractFilePaths(msg.content)) {
          allFiles.add(fp);
        }
      }
    }

    return {
      meta,
      topicCount: topics.length,
      topics,
      toolsUsed: Array.from(toolNames).sort(),
      filesModified: Array.from(allFiles).sort(),
    };
  }

  return null;
}

// ── List sessions ───────────────────────────────────────────────────────────

/**
 * List all sessions with metadata, sorted by startTime descending.
 * Optionally filter by project name (substring match).
 */
export function listSessions(
  project?: string,
): Array<{ project: string; sessionId: string } & SessionMeta> {
  const projects = getProjectDirs().filter(
    (p) => !project || p.name.toLowerCase().includes(project.toLowerCase()),
  );

  const results: Array<{ project: string; sessionId: string } & SessionMeta> = [];

  for (const proj of projects) {
    const sessions = getSessionFiles(proj.path);
    for (const sess of sessions) {
      try {
        const entries = parseSessionFile(sess.file);
        if (entries.length === 0) continue;
        const meta = getSessionMeta(entries);
        results.push({
          project: proj.name,
          sessionId: sess.id,
          ...meta,
        });
      } catch {
        // skip broken files
      }
    }
  }

  // Sort by startTime descending (newest first)
  results.sort((a, b) => {
    if (a.startTime === 'unknown') return 1;
    if (b.startTime === 'unknown') return -1;
    return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
  });

  return results;
}
