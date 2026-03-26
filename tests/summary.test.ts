import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// We test the summary helper functions indirectly since they depend on filesystem discovery.
// The key testable units are the file-path and tool-name extraction regexes.

describe('FILE_PATH_RE extraction', () => {
  const FILE_PATH_RE = /(?:^|[\s"'`(])([.\/~]?(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|vue|svelte|css|scss|html|json|yaml|yml|toml|md|txt|sh|sql|prisma|graphql|proto))\b/g;

  function extractPaths(text: string): string[] {
    const paths = new Set<string>();
    let match;
    FILE_PATH_RE.lastIndex = 0;
    while ((match = FILE_PATH_RE.exec(text)) !== null) {
      paths.add(match[1]);
    }
    return Array.from(paths);
  }

  it('extracts src/foo.ts style paths', () => {
    const paths = extractPaths('Modified src/server.ts and src/types.ts');
    expect(paths).toContain('src/server.ts');
    expect(paths).toContain('src/types.ts');
  });

  it('extracts relative paths with ./', () => {
    const paths = extractPaths('Reading ./config/settings.json');
    expect(paths).toContain('./config/settings.json');
  });

  it('extracts Python paths', () => {
    const paths = extractPaths('Updated app/models/user.py');
    expect(paths).toContain('app/models/user.py');
  });

  it('does not match bare filenames without directory', () => {
    const paths = extractPaths('The file README.md is updated');
    expect(paths.length).toBe(0);
  });

  it('extracts nested paths', () => {
    const paths = extractPaths('Look at src/knowledge/store.ts');
    expect(paths).toContain('src/knowledge/store.ts');
  });
});

describe('TOOL_NAME_RE extraction', () => {
  const TOOL_NAME_RE = /(?:"name"\s*:\s*"([^"]+)"|^(\w+(?:_\w+)*))/;

  function extractToolName(content: string): string | null {
    const match = content.match(TOOL_NAME_RE);
    return match ? match[1] ?? match[2] ?? null : null;
  }

  it('extracts tool name from JSON format', () => {
    expect(extractToolName('{"name": "cortex_search", "args": {}}')).toBe('cortex_search');
  });

  it('extracts tool name from plain text start', () => {
    expect(extractToolName('bash_command some args')).toBe('bash_command');
  });

  it('returns null for empty string', () => {
    expect(extractToolName('')).toBeNull();
  });

  it('extracts name with multiple underscores', () => {
    expect(extractToolName('{"name": "mcp__agent_comm__send"}')).toBe('mcp__agent_comm__send');
  });
});
