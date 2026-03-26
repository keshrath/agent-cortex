# Contributing to agent-knowledge

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/keshrath/agent-knowledge.git
   cd agent-knowledge
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build:
   ```bash
   npm run build
   ```

## Development Setup

### Prerequisites

- **Node.js >= 20** (LTS recommended)
- **Git** (for knowledge base sync)
- A knowledge base repo (or create one):
  ```bash
  mkdir -p ~/claude-memory && cd ~/claude-memory && git init
  mkdir projects people decisions workflows notes
  ```

### Development Mode

```bash
# Watch mode — recompiles on changes
npm run dev

# Start dashboard standalone (port 3423)
KNOWLEDGE_PORT=3423 node dist/dashboard.js

# Run tests
npm test
npm run test:watch
```

### Environment

```bash
export KNOWLEDGE_MEMORY_DIR=~/claude-memory
export CLAUDE_DIR=~/.claude
export KNOWLEDGE_PORT=3423
```

## Project Structure

```
agent-knowledge/
  src/
    index.ts              Entry point (MCP stdio + dashboard auto-start)
    server.ts             MCP server, 10 tool definitions, request routing
    dashboard.ts          HTTP + WebSocket server, REST API, file watcher
    types.ts              KnowledgeConfig, getConfig()
    knowledge/
      store.ts            Markdown CRUD, frontmatter parsing, path traversal protection
      search.ts           TF-IDF search over knowledge entries with regex fallback
      git.ts              git pull/push/sync with timeouts
    sessions/
      parser.ts           JSONL parsing with mtime-based cache
      search.ts           TF-IDF ranked search with 60s global index cache
      scopes.ts           6 search scopes (errors, plans, configs, tools, files, decisions)
      summary.ts          Session summaries, topic extraction, file path detection
    search/
      tfidf.ts            TF-IDF scoring engine (tokenizer, stopwords, index)
      fuzzy.ts            Levenshtein distance, sliding window fuzzy matching
      types.ts            SearchResult, SearchOptions interfaces
    ui/
      index.html          Dashboard SPA
      styles.css           MD3 design tokens (light + dark)
      app.js              Client-side vanilla JS (WebSocket, tabs, rendering)
  tests/
    tfidf.test.ts         TF-IDF engine tests (8)
    fuzzy.test.ts         Fuzzy matching tests (7)
  docs/
    SETUP.md              Installation and configuration guide
    ARCHITECTURE.md       Technical architecture documentation
    DASHBOARD.md          Dashboard features and usage
    assets/               Screenshots
```

## Code Style

- **TypeScript** with strict mode, ES modules
- **Imports**: use `.js` extensions (TypeScript NodeNext convention)
- **Naming**: `camelCase` for functions/variables, `PascalCase` for types/classes, `UPPER_SNAKE` for constants
- **Async**: use `async`/`await` over raw promises
- **Error handling**: throw descriptive errors, catch and return MCP-formatted errors in tool handlers
- **No external formatters** -- match existing code style

## Testing

```bash
npm test                          # Run all tests
npm run test:watch                # Watch mode
npx vitest run tests/tfidf.test.ts  # Single file
npm run lint                      # Type-check (tsc --noEmit)
```

Tests use **vitest** with `fs.mkdtempSync` for temp directories in filesystem tests.

### What to Test

- Knowledge store: CRUD, frontmatter parsing, category validation, path traversal
- TF-IDF: tokenization, stopwords, ranking correctness, edge cases
- Fuzzy: Levenshtein distance, threshold filtering, sliding window
- Sessions: JSONL parsing, malformed line handling, message extraction

## Pull Requests

1. All tests must pass
2. Type-check must be clean (`npm run typecheck`)
3. Lint and format checks must pass (`npm run check`)
4. Update docs if changing tool behavior or adding features
5. Keep commits focused -- one logical change per commit

## License

MIT
