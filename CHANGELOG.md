# Changelog

## 1.0.0 (2026-03-26)

Initial release.

### MCP Tools (12)

**Knowledge (5):** `knowledge_list`, `knowledge_read`, `knowledge_write`, `knowledge_delete`, `knowledge_sync`

**Sessions (5):** `knowledge_sessions`, `knowledge_search`, `knowledge_get`, `knowledge_summary`, `knowledge_recall`

**Admin (2):** `knowledge_index_status`, `knowledge_config`

### Search Engine

- Hybrid semantic + TF-IDF search with configurable alpha blending
- Recency decay weighting (newer sessions rank higher)
- Fuzzy matching via Levenshtein distance
- 6 recall scopes: errors, plans, configs, tools, files, decisions
- Role-based filtering (all, user, assistant)
- Regex mode for pattern-based searches

### Embeddings & Vector Store

- SQLite vector store with sqlite-vec for cosine similarity
- 4 embedding providers: local (Hugging Face), OpenAI, Claude/Voyage, Gemini
- Background indexer runs on server startup
- Automatic provider switching with dimension migration

### Knowledge Base

- Git-synced markdown vault at `~/claude-memory/`
- 5 categories: projects, people, decisions, workflows, notes
- YAML frontmatter for metadata (title, tags, updated)
- Auto git commit + push on writes, pull on reads
- Configurable git URL via `knowledge_config` tool or `KNOWLEDGE_GIT_URL` env var
- New repos auto-scaffolded with README, .gitignore, and category dirs

### Auto-Distillation

- Automatic extraction of session insights into knowledge base
- Project name normalization (worktrees, swarms merged into parent)
- Secrets scrubbing: API keys, tokens, passwords, JWTs, private keys redacted
- System noise stripped (XML tags, task notifications)
- Absolute paths normalized to `~/`
- Defense-in-depth audit blocks writes with surviving sensitive content

### Persistent Configuration

- `knowledge_config` tool for runtime setup (no restart needed)
- Config stored at XDG/AppData location (tool-agnostic)
- Priority: env vars > persisted config > defaults

### Web Dashboard

- http://localhost:3423, auto-starts with MCP server
- 5 tabs: Knowledge, Search, Sessions, Recall, Embeddings
- MD3 design language matching agent-comm and agent-tasks
- Light/dark theme with localStorage persistence
- Side panel (560px, resizable) with markdown rendering
- Live reload via file watcher + WebSocket
- Semantic search toggle with score breakdown

### Performance

- Session file mtime cache (re-parses only changed files)
- Global TF-IDF index cache with 60s TTL
- Background embedding indexer (non-blocking)

### Infrastructure

- REST API: 10 endpoints (knowledge, sessions, search, recall, index-status, health)
- WebSocket server for real-time dashboard updates
- 280 tests passing (vitest)
- TypeScript strict mode, ES modules
- GitHub Actions CI (Node 20/22 matrix, npm publish on tags)
