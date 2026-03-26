import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  getProjectDirs,
  getSessionFiles,
  parseSessionFile,
  extractMessages,
  getSessionMeta,
} from '../sessions/parser.js';
import { getSessionSummary } from '../sessions/summary.js';
import { listEntries, readEntry, writeEntry, parseFrontmatter } from './store.js';
import { gitPull, gitPush } from './git.js';
import { getConfig } from '../types.js';

// ── Cursor tracking ─────────────────────────────────────────────────────────

function getCursorPath(): string {
  const config = getConfig();
  return join(config.claudeDir, '.cortex-distill-cursor');
}

function getLastDistillTime(): string | null {
  const cursorPath = getCursorPath();
  if (!existsSync(cursorPath)) return null;
  try {
    return readFileSync(cursorPath, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

function setLastDistillTime(iso: string): void {
  writeFileSync(getCursorPath(), iso, 'utf-8');
}

// ── Session insight extraction ──────────────────────────────────────────────

interface ProjectInsights {
  sessions: number;
  topics: string[];
  tools: Set<string>;
  files: Set<string>;
  latestDate: string;
}

function extractInsights(cutoff: string | null): Map<string, ProjectInsights> {
  const projects = getProjectDirs();
  const insights = new Map<string, ProjectInsights>();

  for (const proj of projects) {
    const sessions = getSessionFiles(proj.path);

    for (const sess of sessions) {
      try {
        const entries = parseSessionFile(sess.file);
        if (entries.length === 0) continue;

        const meta = getSessionMeta(entries);
        if (meta.startTime === 'unknown') continue;

        if (cutoff && meta.startTime <= cutoff) continue;

        const summary = getSessionSummary(sess.id, proj.name);
        if (!summary) continue;

        const humanTopics = summary.topics
          .map(t => t.content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim())
          .filter(t => t.length > 10 && t.length < 500);

        if (humanTopics.length === 0 && summary.toolsUsed.length === 0) continue;

        let pi = insights.get(proj.name);
        if (!pi) {
          pi = { sessions: 0, topics: [], tools: new Set(), files: new Set(), latestDate: '' };
          insights.set(proj.name, pi);
        }

        pi.sessions++;
        pi.topics.push(...humanTopics.slice(0, 5));
        for (const t of summary.toolsUsed) pi.tools.add(t);
        for (const f of summary.filesModified) pi.files.add(f);
        if (meta.startTime > pi.latestDate) pi.latestDate = meta.startTime;
      } catch {
        continue;
      }
    }
  }

  return insights;
}

// ── Knowledge base update ───────────────────────────────────────────────────

function buildActivitySection(pi: ProjectInsights): string {
  const lines: string[] = [];
  lines.push(`## Recent Activity`);
  lines.push('');
  lines.push(`_Auto-distilled from ${pi.sessions} session(s), last updated ${pi.latestDate.split('T')[0]}_`);
  lines.push('');

  if (pi.topics.length > 0) {
    lines.push('### Topics Discussed');
    const unique = [...new Set(pi.topics)].slice(0, 15);
    for (const topic of unique) {
      const short = topic.length > 150 ? topic.slice(0, 150) + '...' : topic;
      lines.push(`- ${short}`);
    }
    lines.push('');
  }

  if (pi.tools.size > 0) {
    lines.push('### Tools Used');
    lines.push([...pi.tools].sort().join(', '));
    lines.push('');
  }

  if (pi.files.size > 0) {
    lines.push('### Files Touched');
    const fileList = [...pi.files].sort().slice(0, 30);
    for (const f of fileList) {
      lines.push(`- \`${f}\``);
    }
    if (pi.files.size > 30) {
      lines.push(`- _...and ${pi.files.size - 30} more_`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function mergeIntoEntry(existingContent: string, activitySection: string): string {
  const activityMarker = '## Recent Activity';
  const idx = existingContent.indexOf(activityMarker);

  if (idx >= 0) {
    const nextH2 = existingContent.indexOf('\n## ', idx + activityMarker.length);
    if (nextH2 >= 0) {
      return existingContent.slice(0, idx) + activitySection + existingContent.slice(nextH2);
    }
    return existingContent.slice(0, idx) + activitySection;
  }

  return existingContent.trimEnd() + '\n\n' + activitySection;
}

// ── Main distill entry point ────────────────────────────────────────────────

export async function distillSessions(): Promise<{ updated: string[]; created: string[] }> {
  const config = getConfig();
  const cutoff = getLastDistillTime();
  const insights = extractInsights(cutoff);

  if (insights.size === 0) {
    return { updated: [], created: [] };
  }

  await gitPull(config.memoryDir);

  const updated: string[] = [];
  const created: string[] = [];
  let latestDate = cutoff ?? '';

  const existingEntries = listEntries(config.memoryDir, 'projects');
  const entryMap = new Map<string, string>();
  for (const e of existingEntries) {
    const name = e.path.replace(/^projects\//, '').replace(/\.md$/, '').toLowerCase();
    entryMap.set(name, e.path);
  }

  for (const [projectName, pi] of insights) {
    const activitySection = buildActivitySection(pi);
    const normalizedName = projectName
      .replace(/^C--Users-\w+--/i, '')
      .replace(/^\./, '')
      .toLowerCase();
    const existingPath = entryMap.get(normalizedName);

    try {
      if (existingPath) {
        const { content } = readEntry(config.memoryDir, existingPath);
        const merged = mergeIntoEntry(content, activitySection);
        const filename = existingPath.replace(/^projects\//, '');
        writeEntry(config.memoryDir, 'projects', filename, merged);
        updated.push(existingPath);
      } else {
        const filename = `${normalizedName}.md`;
        const content = [
          '---',
          `title: ${projectName}`,
          `tags: [auto-distilled]`,
          `updated: ${new Date().toISOString().split('T')[0]}`,
          '---',
          '',
          `# ${projectName}`,
          '',
          activitySection,
        ].join('\n');
        writeEntry(config.memoryDir, 'projects', filename, content);
        created.push(`projects/${filename}`);
      }
    } catch (err) {
      console.error(`[cortex] Failed to distill project ${projectName}: ${err}`);
    }

    if (pi.latestDate > latestDate) {
      latestDate = pi.latestDate;
    }
  }

  if (updated.length > 0 || created.length > 0) {
    const count = updated.length + created.length;
    await gitPush(config.memoryDir, `distill: update ${count} project(s) from session insights`);
  }

  if (latestDate) {
    setLastDistillTime(latestDate);
  }

  return { updated, created };
}
