# agent-knowledge

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 20](https://img.shields.io/badge/Node-%3E%3D%2020-brightgreen.svg)](https://nodejs.org)
[![Tests: 280 passing](https://img.shields.io/badge/Tests-280%20passing-brightgreen.svg)]()
[![MCP Tools: 12](https://img.shields.io/badge/MCP%20Tools-12-blueviolet.svg)]()

**Cross-session memory and recall for AI coding assistants** -- works with Claude Code, Cursor, OpenCode, Cline, Continue.dev, and Aider out of the box. Git-synced knowledge base, hybrid semantic+TF-IDF search, auto-distillation with secrets scrubbing.

<table>
<tr>
<td><img src="docs/assets/knowledge-light.png" alt="Knowledge Base (light)" width="480"></td>
<td><img src="docs/assets/search-light.png" alt="Session Search" width="480"></td>
</tr>
<tr>
<td align="center"><em>Knowledge base with category filtering</em></td>
<td align="center"><em>TF-IDF ranked session search</em></td>
</tr>
</table>

## Why

AI coding sessions are ephemeral. When a session ends, everything it learned -- architecture decisions, debugging insights, project context -- is gone. The next session starts from scratch.

**agent-knowledge** solves this with two complementary systems:

1. **Knowledge Base** -- a git-synced markdown vault of structured entries (decisions, workflows, project context) that persists across sessions and machines.
2. **Session Search** -- TF-IDF ranked full-text search across session transcripts from all your coding tools, so agents can recall what happened before -- regardless of which tool was used.

## Supported Tools

Sessions from all major AI coding assistants are auto-discovered -- if a tool is installed, its sessions appear automatically.

| Tool             | Format         | Auto-detected path                                              |
| ---------------- | -------------- | --------------------------------------------------------------- |
| **Claude Code**  | JSONL          | `$KNOWLEDGE_DATA_DIR/projects/` (default `~/.claude/projects/`) |
| **Cursor**       | JSONL          | `~/.cursor/projects/*/agent-transcripts/`                       |
| **OpenCode**     | SQLite         | `~/.local/share/opencode/opencode.db` (or `$OPENCODE_DATA_DIR`) |
| **Cline**        | JSON           | VS Code globalStorage `saoudrizwan.claude-dev/tasks/`           |
| **Continue.dev** | JSON           | `~/.continue/sessions/`                                         |
| **Aider**        | Markdown/JSONL | `.aider.chat.history.md` / `.aider.llm.history` in project dirs |

No configuration needed. Additional session roots can be added via the `EXTRA_SESSION_ROOTS` env var (comma-separated paths).

## Features

- **Multi-tool session search** -- unified search across Claude Code, Cursor, OpenCode, Cline, Continue.dev, and Aider sessions
- **Hybrid search** -- semantic vector similarity blended with TF-IDF keyword ranking
- **Git-synced knowledge base** -- markdown vault with YAML frontmatter, auto commit and push on writes
- **Auto-distillation** -- session insights automatically extracted and pushed to git with secrets scrubbing
- **Pluggable adapter system** -- add support for new tools by implementing the `SessionAdapter` interface
- **Embeddings** -- local (Hugging Face), OpenAI, Claude/Voyage, or Gemini providers
- **Fuzzy matching** -- typo-tolerant search using Levenshtein distance
- **6 search scopes** -- errors, plans, configs, tools, files, decisions
- **Configurable git URL** -- `knowledge_config` tool for runtime setup, persisted at XDG/AppData location
- **Cross-machine persistence** -- knowledge syncs via git, sessions read from local storage of each tool
- **Real-time dashboard** -- browse, search, and manage at `localhost:3423`
- **Secrets scrubbing** -- API keys, tokens, passwords, private keys automatically redacted before git push

## Quick Start

```bash
git clone https://github.com/keshrath/agent-knowledge.git
cd agent-knowledge
npm install && npm run build
```

### Configure your MCP client

See [Setup Guide](docs/SETUP.md) for client-specific instructions (Claude Code, Cursor, Windsurf, OpenCode).

Example (Claude Code):

```bash
claude mcp add agent-knowledge -s user \
  -e KNOWLEDGE_MEMORY_DIR="$HOME/agent-knowledge" \
  -- node /path/to/agent-knowledge/dist/index.js
```

Dashboard: **http://localhost:3423** (auto-starts with MCP server)

## MCP Tools

### Knowledge Base

| Tool               | Description                         | Parameters                                       |
| ------------------ | ----------------------------------- | ------------------------------------------------ |
| `knowledge_list`   | List entries by category and/or tag | `category?`, `tag?`                              |
| `knowledge_read`   | Read a specific entry               | `path` (required)                                |
| `knowledge_write`  | Create/update entry (auto git sync) | `category`, `filename`, `content` (all required) |
| `knowledge_delete` | Delete an entry (auto git sync)     | `path` (required)                                |
| `knowledge_sync`   | Manual git pull + push              | --                                               |

### Session Search

| Tool                 | Description                             | Parameters                                                         |
| -------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| `knowledge_sessions` | List sessions with metadata             | `project?`                                                         |
| `knowledge_search`   | TF-IDF ranked search across transcripts | `query` (required), `project?`, `role?`, `max_results?`, `ranked?` |
| `knowledge_get`      | Retrieve full session conversation      | `session_id` (required), `project?`, `include_tools?`, `tail?`     |
| `knowledge_summary`  | Session summary (topics, tools, files)  | `session_id` (required), `project?`                                |
| `knowledge_recall`   | Scoped search across sessions           | `scope` (required), `query` (required), `project?`, `max_results?` |

### Admin

| Tool                     | Description                  | Parameters                                 |
| ------------------------ | ---------------------------- | ------------------------------------------ |
| `knowledge_index_status` | Vector store statistics      | --                                         |
| `knowledge_config`       | View or update configuration | `git_url?`, `memory_dir?`, `auto_distill?` |

## REST API

| Method | Endpoint                                | Description              |
| ------ | --------------------------------------- | ------------------------ |
| GET    | `/api/knowledge`                        | List knowledge entries   |
| GET    | `/api/knowledge/search?q=`              | Search knowledge base    |
| GET    | `/api/knowledge/:path`                  | Read a specific entry    |
| GET    | `/api/sessions`                         | List sessions            |
| GET    | `/api/sessions/search?q=&role=&ranked=` | Search sessions (TF-IDF) |
| GET    | `/api/sessions/recall?scope=&q=`        | Scoped recall            |
| GET    | `/api/sessions/:id`                     | Read a session           |
| GET    | `/api/sessions/:id/summary`             | Session summary          |
| GET    | `/health`                               | Health check             |

## Architecture

```mermaid
graph LR
    subgraph Storage
        KB[(Knowledge Base<br/>~/agent-knowledge<br/>Git Repository)]
    end

    subgraph Session Sources
        CC[(Claude Code<br/>JSONL)]
        CU[(Cursor<br/>JSONL)]
        OC[(OpenCode<br/>SQLite)]
        CL[(Cline<br/>JSON)]
        CD[(Continue.dev<br/>JSON)]
        AI[(Aider<br/>MD / JSONL)]
    end

    subgraph agent-knowledge
        KM[Knowledge Module<br/>store / search / git]
        AD[Session Adapters<br/>auto-discovery]
        SE[Search Engine<br/>TF-IDF + Fuzzy]
        DS[Dashboard<br/>:3423]
        MCP[MCP Server<br/>stdio]
    end

    subgraph Clients
        AG[Agent Sessions]
        WB[Web Browser]
    end

    KB <-->|git pull/push| KM
    CC --> AD
    CU --> AD
    OC --> AD
    CL --> AD
    CD --> AD
    AI --> AD
    AD --> SE
    KM --> MCP
    SE --> MCP
    KM --> DS
    SE --> DS
    MCP --> AG
    DS --> WB
```

## Search Capabilities

**TF-IDF Ranking** -- results scored by term frequency-inverse document frequency. Rare terms boost relevance. Global index cached for 60 seconds.

**Fuzzy Matching** -- Levenshtein edit distance with sliding window. Configurable threshold (default 0.7).

**Scoped Recall** via `knowledge_recall`:

| Scope       | Matches                                   |
| ----------- | ----------------------------------------- |
| `errors`    | Stack traces, exceptions, failed commands |
| `plans`     | Architecture, TODOs, implementation steps |
| `configs`   | Settings, env vars, configuration files   |
| `tools`     | MCP tool calls, CLI commands              |
| `files`     | File paths, modifications                 |
| `decisions` | Trade-offs, rationale, choices            |

## Testing

```bash
npm test              # Run all 280 tests
npm run test:watch    # Watch mode
npm run lint          # Type-check (tsc --noEmit)
```

## Environment Variables

| Variable                                            | Default             | Description                                                           |
| --------------------------------------------------- | ------------------- | --------------------------------------------------------------------- |
| `KNOWLEDGE_MEMORY_DIR`                              | `~/agent-knowledge` | Path to git-synced knowledge base                                     |
| `KNOWLEDGE_GIT_URL`                                 | --                  | Git remote URL (auto-clones if dir missing)                           |
| `KNOWLEDGE_AUTO_DISTILL`                            | `true`              | Auto-distill session insights to knowledge base                       |
| `KNOWLEDGE_EMBEDDING_PROVIDER`                      | `local`             | Embedding provider: `local`, `openai`, `claude`, `gemini`             |
| `KNOWLEDGE_EMBEDDING_ALPHA`                         | `0.3`               | TF-IDF vs semantic blend weight (0=pure semantic, 1=pure TF-IDF)      |
| `KNOWLEDGE_EMBEDDING_IDLE_TIMEOUT`                  | `60`                | Seconds before unloading local model from memory (0 = keep alive)     |
| `KNOWLEDGE_DATA_DIR`                                | `~/.claude`         | Primary session data directory (Claude Code JSONL files)              |
| `EXTRA_SESSION_ROOTS`                               | --                  | Additional session directories, comma-separated paths                 |
| `OPENCODE_DATA_DIR`                                 | (see below)         | Override OpenCode data directory (default: `~/.local/share/opencode`) |
| `KNOWLEDGE_ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY` | --                  | API key for Claude/Voyage embeddings                                  |
| `KNOWLEDGE_PORT`                                    | `3423`              | Dashboard HTTP port                                                   |

## Documentation

- [Setup Guide](docs/SETUP.md) — installation, client setup (Claude Code, OpenCode, Cursor, Windsurf), hooks
- [Architecture](docs/ARCHITECTURE.md) — source structure, design principles, database schema
- [Dashboard](docs/DASHBOARD.md) — web UI views and features
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
