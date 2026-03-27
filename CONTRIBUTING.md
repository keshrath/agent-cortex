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
  mkdir -p ~/agent-knowledge && cd ~/agent-knowledge && git init
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
export KNOWLEDGE_MEMORY_DIR=~/agent-knowledge
export KNOWLEDGE_DATA_DIR=~/.claude       # primary session dir (other tools auto-detected)
export KNOWLEDGE_PORT=3423
```

## Project Structure

```
agent-knowledge/
  src/
    index.ts              Entry point (MCP stdio + dashboard auto-start)
    server.ts             MCP server, 12 tool definitions, request routing
    dashboard.ts          HTTP + WebSocket server, REST API, file watcher
    types.ts              KnowledgeConfig, getConfig()
    knowledge/
      store.ts            Markdown CRUD, frontmatter parsing, path traversal protection
      search.ts           TF-IDF search over knowledge entries with regex fallback
      git.ts              git pull/push/sync with timeouts
    sessions/
      parser.ts           Multi-format session parsing with mtime-based cache
      search.ts           TF-IDF ranked search with 60s global index cache
      scopes.ts           6 search scopes (errors, plans, configs, tools, files, decisions)
      summary.ts          Session summaries, topic extraction, file path detection
      adapters/
        index.ts          SessionAdapter interface, registry, auto-init
        opencode.ts       OpenCode adapter (SQLite)
        cline.ts          Cline adapter (JSON)
        continue.ts       Continue.dev adapter (JSON)
        aider.ts          Aider adapter (Markdown/JSONL)
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
- Session adapters: `isAvailable()` detection, `parseSession()` output normalization, graceful handling of missing/corrupt data

## Adding a Session Adapter

agent-knowledge uses a pluggable adapter system to read sessions from different AI coding tools. To add support for a new tool:

### 1. Create the adapter file

Create `src/sessions/adapters/<tool>.ts` implementing the `SessionAdapter` interface:

```typescript
import type { SessionEntry } from '../parser.js';
import type { SessionAdapter } from './index.js';

export const myToolAdapter: SessionAdapter = {
  prefix: 'mytool', // Unique prefix for virtual descriptors
  name: 'My Tool', // Human-readable name

  isAvailable(): boolean {
    // Return true if this tool is installed on the current machine.
    // Check for the existence of data files/directories.
    return existsSync('/path/to/mytool/data');
  },

  discoverProjects(): Array<{ name: string; path: string }> {
    // Return a list of projects/groups found for this tool.
    // Use `mytool://` prefixed paths as virtual descriptors.
    return [{ name: 'mytool', path: 'mytool://all' }];
  },

  listSessions(projectDescriptor: string): Array<{ id: string; file: string }> {
    // List individual sessions within a project.
    // Return virtual descriptors that parseSession() can handle.
    return [{ id: 'session-1', file: 'mytool://session:session-1' }];
  },

  parseSession(descriptor: string): SessionEntry[] {
    // Parse a session into normalized SessionEntry[] objects.
    // Each entry needs at minimum: type ('user'|'assistant'), message.role, message.content
    return [{ type: 'user', message: { role: 'user', content: 'Hello' } }];
  },
};
```

### 2. Register the adapter

Add a dynamic import to `src/sessions/adapters/index.ts` in the `initAdapters()` function:

```typescript
import('./mytool.js').then((m) => registerAdapter(m.myToolAdapter)).catch(() => {});
```

### 3. Key guidelines

- **Auto-detection only**: `isAvailable()` should check for the tool's data files on disk. No user configuration required.
- **Virtual descriptors**: Use `<prefix>://` URIs so the parser can dispatch to the correct adapter.
- **Graceful failure**: All methods should catch errors and return empty arrays rather than throwing.
- **Read-only access**: Never modify the source tool's data files. Use `{ readonly: true }` for database connections.
- **Platform-aware paths**: Handle Windows, macOS, and Linux path differences (see `cline.ts` for an example).

### 4. Update documentation

- Add the tool to the "Supported Tools" table in `README.md`
- Add the tool to the "Supported Session Sources" list in `CLAUDE.md`
- Add a changelog entry in `CHANGELOG.md`

## Pull Requests

1. All tests must pass
2. Type-check must be clean (`npm run typecheck`)
3. Lint and format checks must pass (`npm run check`)
4. Update docs if changing tool behavior or adding features
5. Keep commits focused -- one logical change per commit

## License

MIT
