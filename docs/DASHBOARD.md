# Dashboard

The dashboard runs at **http://localhost:3423** and auto-starts with the MCP server.

## Tabs

| Tab           | Purpose                                                         |
| ------------- | --------------------------------------------------------------- |
| **Knowledge** | Browse knowledge base entries by category                       |
| **Search**    | TF-IDF ranked search across session transcripts                 |
| **Sessions**  | Browse and read session conversation logs                       |
| **Recall**    | Scoped search (errors, plans, configs, tools, files, decisions) |

## Knowledge Tab

Card grid of knowledge entries. Each card shows:

- Category badge with color: projects (blue), people (purple), decisions (orange), workflows (green), notes (yellow)
- Title and tag pills
- Last updated date

Category filter chips at the top: All, Projects, People, Decisions, Workflows, Notes.

Click a card to open the side panel with rendered markdown content.

## Search Tab

Full-text search across all session transcripts.

**Controls:**

- Search input with debounce (300ms)
- Role filter chips: All, User, Assistant
- Mode toggle: Ranked (TF-IDF) vs Regex

**Results show:**

- Role badge (user/assistant)
- Project name
- Relative timestamp
- Score bar with numeric value
- Excerpt with highlighted matching terms

Click a result to open the session in the side panel.

## Sessions Tab

Lists sessions from all detected AI coding tools with metadata:

- Source tool indicator (Claude Code, Cursor, OpenCode, Cline, Continue.dev, Aider)
- Project name
- Git branch (when available)
- Message count
- Date
- Preview of first user message

Project filter dropdown at the top. Sessions from all tools are merged into a single unified list.

Click a session to open the side panel with the full conversation rendered as chat bubbles.

## Recall Tab

Scoped search that pre-filters results by category:

| Scope       | What it finds                             |
| ----------- | ----------------------------------------- |
| `errors`    | Stack traces, exceptions, failed commands |
| `plans`     | Architecture, TODOs, implementation steps |
| `configs`   | Settings, env vars, configuration files   |
| `tools`     | MCP tool calls, CLI commands              |
| `files`     | File paths, modifications                 |
| `decisions` | Trade-offs, rationale, choices            |

Results use the same format as the Search tab.

## Side Panel

- Width: 560px, resizable by dragging the left edge
- Close: X button or press Escape
- Knowledge entries: rendered as markdown via marked + DOMPurify + highlight.js
- Sessions: chat bubbles (user = right/accent, assistant = left/surface)

## Theming

- Toggle: sun/moon button in header
- Persisted in `localStorage('agent-knowledge-theme')`
- MD3 design tokens matching agent-comm and agent-tasks dashboards
- CSS custom properties on `:root`, switched via `data-theme` attribute

## Live Reload

File watcher monitors `src/ui/` for `.html`, `.css`, `.js` changes. On change, broadcasts `{type: "reload"}` via WebSocket. Connected browsers auto-refresh.

## Keyboard Shortcuts

| Shortcut        | Action             |
| --------------- | ------------------ |
| `/` or `Ctrl+K` | Focus search input |
| `Escape`        | Close side panel   |

## REST API

| Method | Endpoint                                | Description      |
| ------ | --------------------------------------- | ---------------- |
| GET    | `/api/knowledge`                        | List entries     |
| GET    | `/api/knowledge/search?q=`              | Search knowledge |
| GET    | `/api/knowledge/:path`                  | Read entry       |
| GET    | `/api/sessions`                         | List sessions    |
| GET    | `/api/sessions/search?q=&role=&ranked=` | Search sessions  |
| GET    | `/api/sessions/recall?scope=&q=`        | Scoped recall    |
| GET    | `/api/sessions/:id`                     | Read session     |
| GET    | `/api/sessions/:id/summary`             | Session summary  |
| GET    | `/health`                               | Health check     |

## WebSocket

Connects to `ws://localhost:3423` on page load.

**State message** (on connect):

```json
{
  "type": "state",
  "knowledge": [...],
  "sessions": [...],
  "stats": { "knowledge_entries": 12, "session_count": 247 }
}
```

**Reload message** (on file change):

```json
{ "type": "reload" }
```
