# agent-knowledge

## Architecture

Layered architecture — single `server.ts` handles MCP tools, separate `dashboard.ts` for HTTP/WebSocket:

```
src/
  server.ts             MCP server, 12 tool definitions, request routing
  dashboard.ts          HTTP + WebSocket server, REST API, file watcher
  index.ts              Entry point (MCP stdio + dashboard auto-start)
  types.ts              KnowledgeConfig, getConfig(), persisted config
  validate.ts           ValidationError class, input validation
  version.ts            Runtime version from package.json
  knowledge/
    store.ts            Markdown CRUD, frontmatter parsing, path traversal protection
    search.ts           TF-IDF search over knowledge entries with regex fallback
    git.ts              git pull/push/sync with timeouts
    distill.ts          Session auto-distillation with secrets scrubbing
  sessions/
    parser.ts           JSONL parsing with mtime-based cache
    indexer.ts           Background indexing for sessions
    search.ts           TF-IDF ranked search with 60s global index cache
    scopes.ts           Search scopes (errors, plans, configs, tools, files, decisions)
    summary.ts          Session summaries, topic extraction, file path detection
  search/
    tfidf.ts            TF-IDF scoring engine (tokenizer, stopwords, index)
    fuzzy.ts            Levenshtein distance, sliding window fuzzy matching
    excerpt.ts          Search result excerpt generation
    types.ts            SearchResult, SearchOptions interfaces
  embeddings/
    index.ts            Embedding provider registry
    factory.ts          Provider factory (auto-detect available providers)
    types.ts            EmbeddingProvider interface
    claude.ts           Claude/Voyage embeddings
    openai.ts           OpenAI embeddings
    gemini.ts           Gemini embeddings
    local.ts            Local embedding fallback
  vectorstore/
    index.ts            Vector store facade
    store.ts            SQLite-backed vector storage with cosine similarity
    chunker.ts          Document chunking for embedding
  ui/
    index.html          Dashboard SPA
    styles.css          MD3 design tokens (light + dark)
    app.js              Client-side vanilla JS (WebSocket, tabs, rendering)
```

## UI / Dashboard

- **Icons**: Material Symbols Outlined (via Google Fonts CSS). No emojis.
- **Fonts**: Inter (UI text), JetBrains Mono (code/data)
- **Theme**: Light/dark toggle
- **Design tokens**: CSS custom properties (`--bg`, `--accent`, `--border`, `--shadow-*`, etc.)
- **Accent color**: `#5d8da8`
- **Port**: 3423 (configurable via `KNOWLEDGE_PORT`)

## Code Style

- **TypeScript** with strict mode, ES modules
- **Imports**: use `.js` extensions (TypeScript NodeNext convention)
- **Naming**: `camelCase` for functions/variables, `PascalCase` for types/classes, `UPPER_SNAKE` for constants
- **Async**: use `async`/`await` over raw promises
- **Error handling**: throw descriptive errors, catch and return MCP-formatted errors in tool handlers
- **No external formatters** — match existing code style
- **ESLint + Prettier** enforced via lint-staged (husky pre-commit)

## Versioning

- Version lives in `package.json` and is read at runtime via `version.ts`
- Never hardcode version strings

## Build & Test

```
npm run build      # tsc + copy UI files to dist/
npm test           # vitest (unit tests)
npm run check      # typecheck + lint + format + test
npm run dev        # watch mode (tsc --watch)
```

## Key APIs

- **MCP** (12 tools): `knowledge_list`, `knowledge_read`, `knowledge_write`, `knowledge_delete`, `knowledge_search`, `knowledge_recall`, `knowledge_sessions`, `knowledge_summary`, `knowledge_sync`, `knowledge_config`, `knowledge_index_status`, `knowledge_get`
- **Dashboard**: HTTP + WebSocket at port 3423, REST API for entries/sessions/search
- **Git sync**: Auto pull/push on write, manual sync via `knowledge_sync`

## Knowledge Base

- Entries are Markdown files with YAML frontmatter stored in `~/claude-memory/`
- Categories: `projects`, `people`, `decisions`, `workflows`, `notes`
- Search: hybrid semantic (embeddings) + TF-IDF with fuzzy fallback
- Session search scopes: `errors`, `plans`, `configs`, `tools`, `files`, `decisions`, `all`

## Commit Messages

Format: short description. No Co-Authored-By or AI branding.
