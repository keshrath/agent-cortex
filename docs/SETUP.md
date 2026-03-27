# Setup Guide

Detailed instructions for installing, configuring, and integrating agent-knowledge with any MCP client.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Client Setup](#client-setup)
  - [Claude Code](#claude-code)
  - [OpenCode](#opencode)
  - [Cursor](#cursor)
  - [Windsurf](#windsurf)
  - [REST API](#rest-api)
- [Hooks](#hooks)
  - [Claude Code Hooks](#claude-code-hooks)
  - [OpenCode Plugins](#opencode-plugins)
  - [Cursor and Windsurf](#cursor-and-windsurf)
- [Knowledge Base Setup](#knowledge-base-setup)
- [Environment Variables](#environment-variables)
- [Dashboard](#dashboard)
- [Multi-Machine Sync](#multi-machine-sync)
- [Session Auto-Distillation](#session-auto-distillation)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js 20+** (ES modules and TypeScript features)
- **Git** (for knowledge base sync)

```bash
node --version   # v20.0.0 or later
git --version
```

---

## Installation

```bash
git clone https://github.com/keshrath/agent-knowledge.git
cd agent-knowledge
npm install
npm run build
```

For development with auto-rebuild:

```bash
npm run dev
```

---

## Client Setup

agent-knowledge works with any MCP client (stdio) or HTTP client (REST API). Pick your client below.

### Claude Code

#### Register the MCP server

```bash
claude mcp add agent-knowledge -s user \
  -e KNOWLEDGE_MEMORY_DIR="$HOME/claude-memory" \
  -- node /path/to/agent-knowledge/dist/index.js
```

#### Permissions

Add to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["mcp__agent-knowledge__*"]
  }
}
```

#### Verify

```bash
claude mcp list
# Should show: agent-knowledge ... Connected
```

### OpenCode

`opencode.json` (project root) or `~/.config/opencode/opencode.json` (global):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "agent-knowledge": {
      "type": "local",
      "command": ["node", "/absolute/path/to/agent-knowledge/dist/index.js"],
      "environment": {
        "KNOWLEDGE_MEMORY_DIR": "/home/you/claude-memory",
        "KNOWLEDGE_PORT": "3423"
      }
    }
  }
}
```

### Cursor

`.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "agent-knowledge": {
      "command": "node",
      "args": ["/absolute/path/to/agent-knowledge/dist/index.js"],
      "env": {
        "KNOWLEDGE_MEMORY_DIR": "/home/you/claude-memory",
        "KNOWLEDGE_PORT": "3423"
      }
    }
  }
}
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "agent-knowledge": {
      "command": "node",
      "args": ["/absolute/path/to/agent-knowledge/dist/index.js"],
      "env": {
        "KNOWLEDGE_MEMORY_DIR": "/home/you/claude-memory",
        "KNOWLEDGE_PORT": "3423"
      }
    }
  }
}
```

### REST API

If your tool doesn't support MCP, use the REST API:

```bash
# List entries
curl http://localhost:3423/api/knowledge

# Search
curl 'http://localhost:3423/api/knowledge/search?q=deployment+pipeline'

# Read an entry
curl http://localhost:3423/api/knowledge/projects/my-project

# Write an entry
curl -X PUT http://localhost:3423/api/knowledge/notes/my-note \
  -H 'Content-Type: application/json' \
  -d '{"content": "---\ntitle: My Note\ntags: [example]\n---\n\nContent here."}'
```

---

## Hooks

Hooks announce the dashboard URL on session start. Support varies by client.

### Claude Code Hooks

#### SessionStart (`scripts/hooks/session-start.js`)

Announces the knowledge dashboard URL on session start.

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/path/to/agent-knowledge/scripts/hooks/session-start.js\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

### OpenCode Plugins

OpenCode supports lifecycle hooks via JavaScript/TypeScript plugins. Create a plugin in `.opencode/plugins/` or `~/.config/opencode/plugins/`:

```typescript
// .opencode/plugins/agent-knowledge.ts
import type { Plugin } from '@opencode-ai/plugin';

export const AgentKnowledgePlugin: Plugin = async ({ client }) => {
  return {
    event: async (event) => {
      if (event.type === 'session.created') {
        // Knowledge base instructions provided via AGENTS.md
      }
    },
  };
};
```

Available events: `session.created`, `session.idle`, `tool.execute.before`, `tool.execute.after`, `message.updated`, `file.edited`.

Combine with `AGENTS.md` instructions (see below).

### Cursor and Windsurf

Cursor and Windsurf don't support lifecycle hooks. Use the client's system prompt / instructions file:

| Client   | Instructions file |
| -------- | ----------------- |
| Cursor   | `.cursorrules`    |
| Windsurf | `.windsurfrules`  |

Add these instructions:

```
You have access to agent-knowledge MCP tools — a shared knowledge base synced via git.

Available tools: knowledge_list, knowledge_read, knowledge_write, knowledge_search,
knowledge_recall, knowledge_sessions, knowledge_config, knowledge_sync

Categories: projects, people, decisions, workflows, notes

Use knowledge_search for semantic + keyword search across all entries.
Use knowledge_recall for scoped search (errors, plans, configs, tools, files, decisions).

Dashboard: http://localhost:3423
```

---

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

---

## Environment Variables

| Variable                                         | Default           | Description                                        |
| ------------------------------------------------ | ----------------- | -------------------------------------------------- |
| `KNOWLEDGE_MEMORY_DIR`                           | `~/claude-memory` | Path to git-synced knowledge base                  |
| `CLAUDE_MEMORY_DIR`                              | `~/claude-memory` | Alias (backwards compat)                           |
| `CLAUDE_DIR`                                     | `~/.claude`       | Claude Code data directory                         |
| `KNOWLEDGE_PORT`                                 | `3423`            | Dashboard HTTP/WebSocket port                      |
| `KNOWLEDGE_EMBEDDING_PROVIDER`                   | `local`           | Embedding provider (local, openai, claude, gemini) |
| `KNOWLEDGE_EMBEDDING_ALPHA`                      | `0.5`             | Blend weight for semantic vs TF-IDF search (0-1)   |
| `KNOWLEDGE_EMBEDDING_IDLE_TIMEOUT`               | —                 | Idle timeout for embedding worker (ms)             |
| `KNOWLEDGE_EMBEDDING_THREADS`                    | —                 | Number of ONNX threads for local embeddings        |
| `KNOWLEDGE_EMBEDDING_MODEL`                      | —                 | Model name for embedding provider                  |
| `KNOWLEDGE_GIT_URL`                              | —                 | Remote git URL for knowledge base sync             |
| `KNOWLEDGE_AUTO_DISTILL`                         | —                 | Enable auto-distillation of sessions (true/false)  |
| `KNOWLEDGE_OPENAI_API_KEY` / `OPENAI_API_KEY`    | —                 | API key for OpenAI embeddings                      |
| `KNOWLEDGE_CLAUDE_API_KEY` / `ANTHROPIC_API_KEY` | —                 | API key for Claude/Voyage embeddings               |
| `KNOWLEDGE_GEMINI_API_KEY` / `GEMINI_API_KEY`    | —                 | API key for Gemini embeddings                      |

Set in your shell profile or pass via MCP config:

```bash
export KNOWLEDGE_MEMORY_DIR="$HOME/claude-memory"
```

On Windows (PowerShell):

```powershell
$env:KNOWLEDGE_MEMORY_DIR = "$env:USERPROFILE\claude-memory"
```

---

## Dashboard

Auto-starts with the MCP server at **http://localhost:3423**.

4 tabs: Knowledge, Search, Sessions, Embeddings. Supports light/dark theme.

Live reload: edit files in `src/ui/` and the browser refreshes automatically.

---

## Multi-Machine Sync

| Operation                             | Git Action                     | When           |
| ------------------------------------- | ------------------------------ | -------------- |
| `knowledge_read`, `knowledge_list`    | `git pull --rebase`            | Before reading |
| `knowledge_write`, `knowledge_delete` | `git add -A && commit && push` | After writing  |
| `knowledge_sync`                      | `git pull` then `git push`     | Manual trigger |

Ensure git credentials are configured (SSH key or credential helper):

```bash
cd ~/claude-memory && git pull && git push  # Should work without prompts
```

---

## Session Auto-Distillation

agent-knowledge can auto-distill session transcripts into knowledge entries. This currently reads Claude Code session files from `~/.claude/projects/`. Other clients store transcripts differently — auto-distillation only works with Claude Code sessions for now.

To manually save knowledge from any client, use `knowledge_write`.

---

## Troubleshooting

### Port already in use

```bash
# Find the process
netstat -ano | findstr :3423   # Windows
lsof -i :3423                  # Linux/macOS

# Use a different port
export KNOWLEDGE_PORT=3424
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
3. Try running manually: `node /path/to/agent-knowledge/dist/index.js`

### No session results

Verify session transcripts exist:

```bash
ls ~/.claude/projects/  # Should contain project directories with .jsonl files
```

## Client Comparison

| Feature              | Claude Code | OpenCode      | Cursor       | Windsurf       |
| -------------------- | ----------- | ------------- | ------------ | -------------- |
| MCP stdio transport  | Yes         | Yes           | Yes          | Yes            |
| Lifecycle hooks      | Yes (JSON)  | Yes (plugins) | No           | No             |
| Session auto-distill | Yes         | No            | No           | No             |
| System prompt file   | CLAUDE.md   | AGENTS.md     | .cursorrules | .windsurfrules |
| REST API fallback    | Yes         | Yes           | Yes          | Yes            |
