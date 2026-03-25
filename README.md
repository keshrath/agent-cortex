# agent-cortex

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![MCP Tools](https://img.shields.io/badge/MCP%20tools-10-purple)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-ES%20modules-blue)]()

**Memory and session recall for AI agents.** A single MCP server that combines a git-synced knowledge base with TF-IDF ranked search across Claude Code session transcripts.

## Features

- **TF-IDF ranked search** -- results ordered by relevance, not just regex position
- **Fuzzy matching** -- typo-tolerant search with configurable thresholds
- **Scoped recall** -- specialized search for errors, plans, configs, tools, files, or decisions
- **Git-synced knowledge base** -- markdown vault with YAML frontmatter, auto commit and push on writes
- **Cross-machine persistence** -- knowledge base syncs via git across all machines
- **Stateless session search** -- no indexing step, no database, reads JSONL files directly
- **Zero external dependencies** for search -- no Tantivy, no vector DB, no embeddings
- **10 MCP tools** -- five for knowledge management, five for session search

## Quick Start

### Install

```bash
git clone https://gitlab.mukit.at/development/agent-cortex.git
cd agent-cortex
npm install
npm run build
```

### Configure in Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "agent-cortex": {
      "command": "node",
      "args": ["/path/to/agent-cortex/dist/index.js"]
    }
  }
}
```

### Usage

Once configured, the 10 `cortex_*` tools are available in any Claude Code session:

```
cortex_list                                         List entries by category or tag
cortex_write category=projects filename=my-app      Create/update a knowledge entry
cortex_read path=projects/my-app.md                 Read a knowledge entry
cortex_search query="database migration"            TF-IDF ranked session search
cortex_recall scope=errors query="TypeError"        Scoped search for errors
cortex_summary session_id="abc-123"                 Session summary
```

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `CORTEX_MEMORY_DIR` | `~/claude-memory` | Path to the git-synced knowledge base directory |
| `CLAUDE_MEMORY_DIR` | `~/claude-memory` | Alias for `CORTEX_MEMORY_DIR` (backwards compat) |
| `CLAUDE_DIR` | `~/.claude` | Path to the Claude Code data directory |

## Tools Reference

### Knowledge Base Tools

| Tool | Description | Parameters |
|---|---|---|
| `cortex_list` | List entries by category and/or tag | `category?` (projects, people, decisions, workflows, notes), `tag?` |
| `cortex_read` | Read a specific entry | `path` (relative, e.g. `projects/odoo-19.md`) |
| `cortex_write` | Create or update an entry (auto git sync) | `category`, `filename`, `content` |
| `cortex_delete` | Delete an entry (auto git sync) | `path` (relative) |
| `cortex_sync` | Manual git pull + push | _(none)_ |

### Session Search Tools

| Tool | Description | Parameters |
|---|---|---|
| `cortex_sessions` | List sessions with metadata | `project?` (substring filter) |
| `cortex_search` | TF-IDF ranked search across transcripts | `query`, `project?`, `role?` (user/assistant/all), `max_results?`, `ranked?` |
| `cortex_get` | Retrieve full conversation from a session | `session_id`, `project?`, `include_tools?`, `tail?` |
| `cortex_summary` | Session summary with topics, tools, files | `session_id`, `project?` |
| `cortex_recall` | Scoped search across sessions | `scope` (errors/plans/configs/tools/files/decisions/all), `query`, `project?`, `max_results?` |

## Architecture

```
agent-cortex/
  src/
    index.ts              Entry point (stdio transport)
    server.ts             MCP server, tool definitions, request routing
    types.ts              Config and shared types
    knowledge/
      store.ts            Markdown CRUD with frontmatter parsing
      search.ts           Knowledge base search with TF-IDF
      git.ts              Git pull/commit/push operations
    sessions/
      parser.ts           JSONL session file parsing
      search.ts           Session transcript search with TF-IDF
      scopes.ts           Specialized search scope filters
      summary.ts          Session summaries and listing
    search/
      tfidf.ts            TF-IDF scoring engine
      fuzzy.ts            Levenshtein fuzzy matching
      types.ts            Shared search result types
  tests/
    tfidf.test.ts         TF-IDF engine tests
    fuzzy.test.ts         Fuzzy matching tests
    knowledge.test.ts     Knowledge store tests
    sessions.test.ts      Session parser tests
```

## Search Capabilities

### TF-IDF Ranking

Results are ranked using term frequency-inverse document frequency scoring. Documents containing rare, distinctive terms rank higher than those with common words. The implementation is self-contained -- no external search libraries.

### Fuzzy Matching

Handles typos and near-matches using Levenshtein edit distance with a sliding window approach. Configurable threshold (default: 0.7, where 1.0 = exact match).

### Search Scopes

The `cortex_recall` tool supports predefined scopes:

| Scope | Matches |
|---|---|
| `errors` | Stack traces, error messages, exceptions, failed commands |
| `plans` | Implementation plans, architecture, step-by-step approaches |
| `configs` | Configuration files, env vars, settings changes |
| `tools` | Tool invocations, CLI commands, build/test runs |
| `files` | File paths, modifications, directory structures |
| `decisions` | Design decisions, trade-off discussions, rationale |

## Knowledge Base

### Categories

| Category | Purpose |
|---|---|
| `projects` | Project context, architecture, tech stack |
| `people` | Team members, contacts, preferences |
| `decisions` | Architecture decisions, trade-offs, rationale |
| `workflows` | Repeatable processes, deployment steps |
| `notes` | Everything else |

### Frontmatter Format

```markdown
---
title: My Application
tags: [typescript, react, postgres]
updated: 2026-03-25
---

Architecture notes, deployment info, etc.
```

### Git Sync

- **On read**: pulls latest changes before returning content
- **On write/delete**: commits and pushes automatically
- **Manual sync**: `cortex_sync` runs a full pull + push cycle
- **Conflict resolution**: uses `git pull --rebase`

## Session Search

Claude Code stores session transcripts as JSONL files under `~/.claude/projects/`. Each line is a JSON object with a `type` field (`user`, `assistant`, `tool_use`, `tool_result`) and associated content.

No pre-built index is needed. The search reads files on demand, working immediately with new sessions.

## Development

```bash
npm run build          # Compile TypeScript
npm test               # Run tests with vitest
npm run test:watch     # Watch mode
npm run lint           # Type-check with tsc --noEmit
npm run dev            # Watch mode compilation
```

## Related Projects

| Project | Description |
|---|---|
| [agent-comm](https://gitlab.mukit.at/development/agent-comm) | Inter-agent messaging, channels, shared state, real-time dashboard |
| [agent-tasks](https://gitlab.mukit.at/development/agent-tasks) | Pipeline task management with stages, dependencies, approvals |

Together, the three servers form a complete multi-agent coordination stack:

- **agent-comm** -- agents discover and talk to each other
- **agent-tasks** -- agents coordinate work through a shared pipeline
- **agent-cortex** -- agents remember what happened and recall past context

## License

MIT
