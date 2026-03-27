# Architecture

## Overview

```mermaid
graph TB
    Claude[Claude Code] -->|MCP stdio| Server[server.ts]
    Server --> Knowledge[Knowledge Module]
    Server --> Session[Session Module]

    Knowledge --> Store[store.ts — CRUD]
    Knowledge --> KSearch[search.ts — TF-IDF]
    Knowledge --> Git[git.ts — Sync]

    Store --> Vault[(~/claude-memory)]
    Git --> Remote[(Git Remote)]

    Session --> Parser[parser.ts — JSONL + Cache]
    Session --> SSearch[search.ts — TF-IDF Index]
    Session --> Scopes[scopes.ts — 6 Filters]
    Session --> Summary[summary.ts]

    Parser --> Transcripts[(~/.claude/projects/*.jsonl)]

    Server --> Dashboard[dashboard.ts — :3423]
    Dashboard --> HTTP[REST API]
    Dashboard --> WS[WebSocket]
    Dashboard --> Watcher[File Watcher]
    HTTP --> Browser[Browser UI]
    WS --> Browser
```

## File Structure

```
src/
  index.ts              Entry point — MCP stdio + dashboard auto-start
  server.ts             12 tool definitions, request routing, error handling
  dashboard.ts          HTTP + WebSocket server, REST API, file watcher
  types.ts              KnowledgeConfig interface, getConfig()
  knowledge/
    store.ts            CRUD for markdown entries with YAML frontmatter
    search.ts           TF-IDF search over knowledge entries
    git.ts              git pull/push/sync with execSync + timeouts
  sessions/
    parser.ts           JSONL parsing with mtime-based file cache
    search.ts           TF-IDF ranked search with 60s global index cache
    scopes.ts           6 search scopes, post-filters cached index results
    summary.ts          Topic extraction, tool/file detection
  search/
    tfidf.ts            TF-IDF scoring engine (tokenizer, stopwords, index)
    fuzzy.ts            Levenshtein distance, sliding window matching
    types.ts            SearchResult, SearchOptions interfaces
  ui/
    index.html          Dashboard SPA
    styles.css           MD3 design tokens (light + dark)
    app.js              Client-side JS (WebSocket, tabs, rendering)
```

## Knowledge Module

### store.ts

CRUD for markdown files with YAML frontmatter:

- **parseFrontmatter()** — splits on `---` delimiters, extracts title/tags/updated
- **listEntries()** — recursively finds `.md` files, skips dot-directories, filters by category/tag
- **readEntry()** — reads file with path traversal protection (`path.resolve` must start with base dir)
- **writeEntry()** — validates category against allowed list, ensures directory exists, auto-adds `.md`
- **deleteEntry()** — removes file with path traversal protection

### git.ts

Wraps `execSync` for git operations with timeouts:

- `gitPull()` — `git pull --rebase --quiet` (15s timeout)
- `gitPush()` — `git add -A`, conditional commit (checks `git diff --cached --quiet`), push (5s/5s/15s)
- `gitSync()` — pull then push, returns both results

### search.ts

Builds a TF-IDF index from all knowledge entries, searches with ranking, falls back to regex for exact phrases.

## Session Module

### parser.ts — Mtime Cache

Before parsing a JSONL file, checks `fs.statSync` for mtime. If unchanged since last parse, returns cached result. This avoids re-parsing large transcript files on every search.

```
parseSessionFile(path)
  → statSync(path).mtimeMs
  → if mtime matches cache → return cached entries
  → else parse JSONL lines → cache with mtime → return
```

### search.ts — Global TF-IDF Index

Maintains a single TF-IDF index across all sessions with a 60-second TTL:

```
getOrBuildIndex(projects)
  → if cache exists AND age < 60s → return cached index
  → else scan all sessions → parse (using mtime cache) → index all messages → cache → return
```

Role filtering happens post-search: the index includes all roles, and results are filtered after scoring.

### scopes.ts

Uses the cached search index from `search.ts` (via `searchSessions`), then post-filters by scope patterns:

| Scope       | Filter                                                          |
| ----------- | --------------------------------------------------------------- |
| `errors`    | Regex: Error, Exception, failed, crash, ENOENT, TypeError, etc. |
| `plans`     | Regex: plan, step, phase, strategy, TODO, architecture, etc.    |
| `configs`   | Regex: config, .env, .json, tsconfig, docker, etc.              |
| `tools`     | Role filter: tool_use, tool_result messages only                |
| `files`     | Regex: src/, .ts, .js, created, modified, deleted, etc.         |
| `decisions` | Regex: decided, chose, because, tradeoff, opted for, etc.       |

### summary.ts

Extracts session summaries:

- **Topics**: user messages filtered to exclude JSON/tool_result/base64/system-reminders
- **Tools used**: tool names from tool_use entries
- **Files modified**: file paths detected via regex in tool_result content

## Search Engine

### tfidf.ts

Self-contained TF-IDF implementation:

**Tokenization**: lowercase → split on `[^a-z0-9]+` → remove ~100 English stopwords

**Scoring**:

```
TF(t, d)  = count(t in d) / total_terms(d)
IDF(t)    = log(1 + N / docs_containing(t))
Score(q, d) = sum(TF(t, d) * IDF(t)) for each term t in query q
```

The `1 +` in IDF ensures single-document results still get a positive score.

### fuzzy.ts

Levenshtein edit distance with two-row DP (O(n\*m) time, O(m) space). Fuzzy matching uses a sliding window of varying size to find approximate substring matches.

## Dashboard

### dashboard.ts

Single HTTP server handles both REST API and static files:

- **Static serving**: resolves UI directory (checks `src/ui/` then `dist/ui/`), serves with MIME detection and CSP headers
- **REST API**: routes for knowledge CRUD/search, session list/search/recall/get/summary, health
- **WebSocket**: `ws` library with `noServer` mode, heartbeat every 30s, initial state snapshot on connect
- **File watcher**: `fs.watch` on UI directory, debounced 200ms, broadcasts `{type: "reload"}` to all WS clients

### UI Architecture

Vanilla JS SPA (no framework, no build step):

- WebSocket connects on load, handles `state` and `reload` messages
- 4 tabs with lazy data loading
- `marked` + `DOMPurify` + `highlight.js` for markdown rendering
- Theme persisted in `localStorage('agent-knowledge-theme')`

## Caching Strategy

```
Search Request
    │
    ▼
┌─────────────────────┐
│ TF-IDF index < 60s? │──Yes──► Search cached index (~40ms)
└─────────────────────┘
    │ No
    ▼
┌─────────────────────┐
│ Scan session files  │
│ Check mtime cache   │──► Parse only changed files
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│ Rebuild index       │──► Cache with 60s TTL (~5s cold)
└─────────────────────┘
    │
    ▼
  Search new index
```

## Data Flow

### Session Search

```mermaid
sequenceDiagram
    participant C as Claude Code
    participant S as MCP Server
    participant I as TF-IDF Index
    participant P as Parser Cache
    participant F as File System

    C->>S: knowledge_search({ query })
    S->>I: search(query)
    alt Index expired
        I->>F: List .jsonl files
        loop Each file
            alt Mtime changed
                I->>P: parse(file)
                P->>F: Read JSONL
                P-->>I: Parsed entries
            else Mtime unchanged
                I->>P: getCached(file)
                P-->>I: Cached entries
            end
        end
        I->>I: Rebuild index
    end
    I-->>S: Ranked results
    S-->>C: SearchResult[]
```

### Knowledge Write

```mermaid
sequenceDiagram
    participant C as Claude Code
    participant S as MCP Server
    participant G as Git
    participant F as File System

    C->>S: knowledge_write({ category, filename, content })
    S->>G: git pull --rebase
    S->>F: Write markdown file
    S->>G: git add -A && commit && push
    G-->>S: Push result
    S-->>C: { path, git status }
```
