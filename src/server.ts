import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { listEntries, readEntry, writeEntry, deleteEntry } from "./knowledge/store.js";
import { gitPull, gitPush, gitSync } from "./knowledge/git.js";
import { searchKnowledge } from "./knowledge/search.js";
import { searchSessions } from "./sessions/search.js";
import { listSessions, getSessionSummary } from "./sessions/summary.js";
import { scopedSearch, type SearchScope } from "./sessions/scopes.js";
import {
  getProjectDirs,
  getSessionFiles,
  parseSessionFile,
  extractMessages,
  getSessionMeta,
} from "./sessions/parser.js";
import { getConfig } from "./types.js";

const CATEGORIES = ["projects", "people", "decisions", "workflows", "notes"] as const;
const SCOPES = ["errors", "plans", "configs", "tools", "files", "decisions", "all"] as const;

export function createServer(): Server {
  const server = new Server(
    { name: "agent-cortex", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "cortex_list",
        description:
          "List knowledge base entries. Optionally filter by category or tag. " +
          "Returns an array of entry paths with their frontmatter metadata.",
        inputSchema: {
          type: "object" as const,
          properties: {
            category: {
              type: "string",
              enum: [...CATEGORIES],
              description: "Filter by category (projects, people, decisions, workflows, notes)",
            },
            tag: {
              type: "string",
              description: "Filter by tag — matches entries whose frontmatter tags array contains this value",
            },
          },
        },
      },
      {
        name: "cortex_read",
        description:
          "Read the full content of a knowledge base entry by its path (relative to the memory dir). " +
          "Returns the raw markdown including frontmatter.",
        inputSchema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "Relative path to the entry, e.g. 'projects/my-project.md'",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "cortex_write",
        description:
          "Create or update a knowledge base entry. The file is written under the given category directory. " +
          "Content should be markdown (frontmatter is optional). " +
          "Automatically commits and pushes after writing.",
        inputSchema: {
          type: "object" as const,
          properties: {
            category: {
              type: "string",
              enum: [...CATEGORIES],
              description: "Category directory to write into",
            },
            filename: {
              type: "string",
              description: "Filename (with or without .md extension), e.g. 'my-project.md'",
            },
            content: {
              type: "string",
              description: "Full markdown content for the entry",
            },
          },
          required: ["category", "filename", "content"],
        },
      },
      {
        name: "cortex_delete",
        description:
          "Delete a knowledge base entry by path. Automatically commits and pushes after deletion.",
        inputSchema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "Relative path to the entry to delete, e.g. 'notes/old-note.md'",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "cortex_sync",
        description:
          "Synchronize the knowledge base with the remote git repository (pull then push). " +
          "Use this to ensure you have the latest entries from other machines/sessions.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "cortex_sessions",
        description:
          "List Claude Code sessions with metadata (timestamps, branch, message counts, preview). " +
          "Optionally filter to a specific project. Returns sessions sorted newest first.",
        inputSchema: {
          type: "object" as const,
          properties: {
            project: {
              type: "string",
              description: "Filter by project name (substring match)",
            },
          },
        },
      },
      {
        name: "cortex_search",
        description:
          "TF-IDF ranked search across Claude Code session conversations. " +
          "Searches message content and returns matches with context and relevance scores. " +
          "Use this to find past discussions, decisions, code snippets, or error messages.",
        inputSchema: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description: "Search query — supports keywords and phrases",
            },
            project: {
              type: "string",
              description: "Restrict search to sessions from this project",
            },
            role: {
              type: "string",
              enum: ["user", "assistant", "all"],
              description: "Filter by message role (default: all)",
            },
            max_results: {
              type: "number",
              description: "Maximum number of results to return (default: 20)",
            },
            ranked: {
              type: "boolean",
              description: "Use TF-IDF ranking (default: true). Set false for regex mode.",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "cortex_get",
        description:
          "Retrieve the full conversation from a specific session. " +
          "Optionally include tool-use messages and/or limit to the last N messages.",
        inputSchema: {
          type: "object" as const,
          properties: {
            session_id: {
              type: "string",
              description: "The session UUID to retrieve",
            },
            project: {
              type: "string",
              description: "Project name to narrow lookup",
            },
            include_tools: {
              type: "boolean",
              description: "Include tool_use and tool_result messages (default: false)",
            },
            tail: {
              type: "number",
              description: "Only return the last N messages from the conversation",
            },
          },
          required: ["session_id"],
        },
      },
      {
        name: "cortex_summary",
        description:
          "Get a concise summary of a session: topics discussed, tools used, files modified. " +
          "Useful for quickly understanding what happened in a past session.",
        inputSchema: {
          type: "object" as const,
          properties: {
            session_id: {
              type: "string",
              description: "The session UUID to summarize",
            },
            project: {
              type: "string",
              description: "Project name to narrow lookup",
            },
          },
          required: ["session_id"],
        },
      },
      {
        name: "cortex_recall",
        description:
          "Scoped search across sessions — search within a specific domain like errors, " +
          "plans, configs, tool usage, file references, or decisions. " +
          "More targeted than cortex_search when you know what kind of information you need.",
        inputSchema: {
          type: "object" as const,
          properties: {
            scope: {
              type: "string",
              enum: [...SCOPES],
              description:
                "Search scope: errors (stack traces, exceptions), plans (architecture, TODOs), " +
                "configs (settings, env vars), tools (MCP tool calls), " +
                "files (file paths, code refs), decisions (trade-offs, choices), all (no filter)",
            },
            query: {
              type: "string",
              description: "Search query within the chosen scope",
            },
            project: {
              type: "string",
              description: "Restrict to sessions from this project",
            },
            max_results: {
              type: "number",
              description: "Maximum number of results (default: 20)",
            },
          },
          required: ["scope", "query"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const config = getConfig();

    try {
      switch (name) {
        case "cortex_list": {
          await gitPull(config.memoryDir);
          const entries = listEntries(
            config.memoryDir,
            args.category as string | undefined,
            args.tag as string | undefined,
          );
          return ok(entries);
        }

        case "cortex_read": {
          await gitPull(config.memoryDir);
          const result = readEntry(config.memoryDir, args.path as string);
          return ok(result);
        }

        case "cortex_write": {
          await gitPull(config.memoryDir);
          const filePath = writeEntry(
            config.memoryDir,
            args.category as string,
            args.filename as string,
            args.content as string,
          );
          const pushResult = await gitPush(config.memoryDir);
          return ok({ path: filePath, git: pushResult });
        }

        case "cortex_delete": {
          await gitPull(config.memoryDir);
          const deleted = deleteEntry(config.memoryDir, args.path as string);
          const pushResult = await gitPush(config.memoryDir);
          return ok({ deleted, git: pushResult });
        }

        case "cortex_sync": {
          const result = await gitSync(config.memoryDir);
          return ok(result);
        }

        case "cortex_sessions": {
          const sessions = listSessions(
            args.project as string | undefined,
          );
          return ok(sessions);
        }

        case "cortex_search": {
          const results = searchSessions(
            args.query as string,
            {
              project: args.project as string | undefined,
              role: (args.role as "user" | "assistant" | "all") ?? "all",
              maxResults: (args.max_results as number) ?? 20,
              ranked: (args.ranked as boolean) ?? true,
            },
          );
          return ok(results);
        }

        case "cortex_get": {
          const sessionId = args.session_id as string;
          const projectFilter = args.project as string | undefined;
          const includeTools = (args.include_tools as boolean) ?? false;
          const tail = args.tail as number | undefined;

          const projects = getProjectDirs().filter(
            p => !projectFilter || p.name.toLowerCase().includes(projectFilter.toLowerCase()),
          );

          for (const proj of projects) {
            const sessions = getSessionFiles(proj.path);
            const match = sessions.find(s => s.id === sessionId);
            if (match) {
              const entries = parseSessionFile(match.file);
              let messages = extractMessages(entries);
              if (!includeTools) {
                messages = messages.filter(
                  m => m.role === "user" || m.role === "assistant",
                );
              }
              if (tail && tail > 0) {
                messages = messages.slice(-tail);
              }
              const meta = getSessionMeta(entries);
              return ok({ meta, messages });
            }
          }

          return err(`Session ${sessionId} not found.`);
        }

        case "cortex_summary": {
          const result = getSessionSummary(
            args.session_id as string,
            args.project as string | undefined,
          );
          if (!result) {
            return err(`Session ${args.session_id} not found.`);
          }
          return ok(result);
        }

        case "cortex_recall": {
          const results = scopedSearch(
            args.scope as SearchScope,
            args.query as string,
            {
              project: args.project as string | undefined,
              maxResults: (args.max_results as number) ?? 20,
            },
          );
          return ok(results);
        }

        default:
          return err(`Unknown tool: ${name}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(`Error in ${name}: ${message}`);
    }
  });

  return server;
}

function ok(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

function err(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}
