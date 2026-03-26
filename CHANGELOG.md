# Changelog

## 1.0.0 (2026-03-26)

Initial release.

### MCP Tools (10)

**Knowledge (5):** `cortex_list`, `cortex_read`, `cortex_write`, `cortex_delete`, `cortex_sync`

**Sessions (5):** `cortex_sessions`, `cortex_search`, `cortex_get`, `cortex_summary`, `cortex_recall`

### Search Engine

- TF-IDF ranked search with 60s cached index (~40ms warm queries)
- Fuzzy matching via Levenshtein distance
- 6 recall scopes: errors, plans, configs, tools, files, decisions
- Role-based filtering (all, user, assistant)
- Regex mode for pattern-based searches

### Knowledge Base

- Git-synced markdown vault at `~/claude-memory/`
- 5 categories: projects, people, decisions, workflows, notes
- YAML frontmatter for metadata (title, tags, updated)
- Auto git commit + push on writes, pull on reads

### Web Dashboard

- http://localhost:3423, auto-starts with MCP server
- 4 tabs: Knowledge, Search, Sessions, Recall
- MD3 design language matching agent-comm and agent-tasks
- Light/dark theme with localStorage persistence
- Side panel (560px, resizable) with markdown rendering
- Live reload via file watcher + WebSocket
- Keyboard shortcuts: `/` or `Ctrl+K` for search, `Esc` to close panel

### Performance

- Session file mtime cache (re-parses only changed files)
- Global TF-IDF index cache with 60s TTL
- Cold start ~5s, warm queries ~40ms

### Infrastructure

- REST API: 9 endpoints (knowledge, sessions, search, recall, health)
- WebSocket server for real-time dashboard updates
- 15 tests passing (vitest)
- TypeScript strict mode, ES modules
