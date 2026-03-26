# Setup Guide

## Prerequisites

- **Node.js 20+** (ES modules and TypeScript features)
- **Git** (for knowledge base sync)

```bash
node --version   # v20.0.0 or later
git --version
```

## Installation

```bash
git clone https://gitlab.mukit.at/development/agent-cortex.git
cd agent-cortex
npm install
npm run build
```

For development with auto-rebuild:

```bash
npm run dev
```

## Configuration in Claude Code

### Register the MCP server

```bash
claude mcp add agent-cortex -s user \
  -e CORTEX_MEMORY_DIR="$HOME/claude-memory" \
  -- node /path/to/agent-cortex/dist/index.js
```

### Permissions

Add to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["mcp__agent-cortex__*"]
  }
}
```

### Verify

```bash
claude mcp list
# Should show: agent-cortex ... Connected
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CORTEX_MEMORY_DIR` | `~/claude-memory` | Path to git-synced knowledge base |
| `CLAUDE_MEMORY_DIR` | `~/claude-memory` | Alias (backwards compat) |
| `CLAUDE_DIR` | `~/.claude` | Claude Code data directory |
| `CORTEX_PORT` | `3423` | Dashboard HTTP/WebSocket port |

Set in your shell profile or pass via MCP config:

```bash
export CORTEX_MEMORY_DIR="$HOME/claude-memory"
```

On Windows (PowerShell):

```powershell
$env:CORTEX_MEMORY_DIR = "$env:USERPROFILE\claude-memory"
```

## Knowledge Base Setup

The knowledge base is a git repository with categorized markdown files.

### Clone existing or create new

```bash
# Clone existing
git clone https://your-git-host/claude-memory.git ~/claude-memory

# Or create new
mkdir -p ~/claude-memory && cd ~/claude-memory && git init
mkdir projects people decisions workflows notes
git add . && git commit -m "Initialize knowledge base"
git remote add origin <your-remote-url>
git push -u origin main
```

### Directory structure

```
~/claude-memory/
  projects/       # Project context, architecture, tech stacks
  people/         # Team members, contacts, preferences
  decisions/      # Architecture decisions, trade-offs, rationale
  workflows/      # Processes, deployment steps, runbooks
  notes/          # General notes, research, references
```

### Entry format

```markdown
---
title: My Project
tags: [typescript, react, postgres]
updated: 2026-03-25
---

# My Project

Architecture notes, deployment info, etc.
```

## Dashboard

Auto-starts with the MCP server at **http://localhost:3423**.

4 tabs: Knowledge, Search, Sessions, Recall. Supports light/dark theme.

Live reload: edit files in `src/ui/` and the browser refreshes automatically.

## Multi-Machine Sync

| Operation | Git Action | When |
|---|---|---|
| `cortex_read`, `cortex_list` | `git pull --rebase` | Before reading |
| `cortex_write`, `cortex_delete` | `git add -A && commit && push` | After writing |
| `cortex_sync` | `git pull` then `git push` | Manual trigger |

Ensure git credentials are configured (SSH key or credential helper):

```bash
cd ~/claude-memory && git pull && git push  # Should work without prompts
```

## Troubleshooting

### Port already in use

```bash
# Find the process
netstat -ano | findstr :3423   # Windows
lsof -i :3423                  # Linux/macOS

# Use a different port
export CORTEX_PORT=3424
```

### Git authentication failures

Verify credentials work manually:

```bash
cd ~/claude-memory && git push
```

Set up SSH keys or a credential helper if prompted.

### MCP server not connecting

1. Check path points to `dist/index.js` (not `src/index.ts`)
2. Verify Node.js 20+ is on your PATH
3. Try running manually: `node /path/to/agent-cortex/dist/index.js`

### No session results

Verify session transcripts exist:

```bash
ls ~/.claude/projects/  # Should contain project directories with .jsonl files
```
