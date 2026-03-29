import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { listEntries, readEntry, writeEntry, deleteEntry } from './knowledge/store.js';
import { gitPull, gitPush, gitSync, ensureRepo } from './knowledge/git.js';
import { getKnowledgeGraph, RELATIONSHIP_TYPES, type RelationshipType } from './knowledge/graph.js';
import { getEntryScoring } from './knowledge/scoring.js';
import { indexKnowledgeEntry } from './sessions/indexer.js';
import { searchSessions } from './sessions/search.js';
import { listSessions, getSessionSummary } from './sessions/summary.js';
import { scopedSearch, type SearchScope } from './sessions/scopes.js';
import { backgroundIndex } from './sessions/indexer.js';
import { VectorStore } from './vectorstore/index.js';
import {
  getProjectDirs,
  getSessionFiles,
  parseSessionFile,
  extractMessages,
  getSessionMeta,
} from './sessions/parser.js';
import { getConfig, loadPersistedConfig, savePersistedConfig, getConfigLocation } from './types.js';
import { getVersion } from './version.js';

const CATEGORIES = ['projects', 'people', 'decisions', 'workflows', 'notes'] as const;
const SCOPES = ['errors', 'plans', 'configs', 'tools', 'files', 'decisions', 'all'] as const;

// ── Input validation helpers ─────────────────────────────────────────────────

function requireString(args: Record<string, unknown>, key: string, label?: string): string {
  const val = args[key];
  if (val === undefined || val === null || typeof val !== 'string') {
    throw new Error(`Missing or invalid required parameter: ${label ?? key} (expected string)`);
  }
  if (val.length === 0) {
    throw new Error(`Parameter ${label ?? key} must not be empty`);
  }
  return val;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const val = args[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== 'string') {
    throw new Error(`Parameter ${key} must be a string`);
  }
  return val;
}

function optionalNumber(
  args: Record<string, unknown>,
  key: string,
  min?: number,
  max?: number,
): number | undefined {
  const val = args[key];
  if (val === undefined || val === null) return undefined;
  const num = typeof val === 'number' ? val : Number(val);
  if (isNaN(num)) {
    throw new Error(`Parameter ${key} must be a number`);
  }
  if (min !== undefined && num < min) {
    throw new Error(`Parameter ${key} must be >= ${min}`);
  }
  if (max !== undefined && num > max) {
    throw new Error(`Parameter ${key} must be <= ${max}`);
  }
  return num;
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const val = args[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'boolean') return val;
  if (val === 'true') return true;
  if (val === 'false') return false;
  throw new Error(`Parameter ${key} must be a boolean`);
}

function validateEnum<T extends string>(
  val: string | undefined,
  allowed: readonly T[],
  key: string,
): T | undefined {
  if (val === undefined) return undefined;
  if (!allowed.includes(val as T)) {
    throw new Error(`Parameter ${key} must be one of: ${allowed.join(', ')}`);
  }
  return val as T;
}

export interface ServerOptions {
  /** Only the leader instance (dashboard owner) runs background indexing. */
  isLeader?: boolean;
}

export function createServer(options?: ServerOptions): Server {
  const server = new Server(
    { name: 'agent-knowledge', version: getVersion() },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'knowledge_list',
        description:
          'List knowledge base entries. Optionally filter by category or tag. ' +
          'Returns an array of entry paths with their frontmatter metadata.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            category: {
              type: 'string',
              enum: [...CATEGORIES],
              description: 'Filter by category (projects, people, decisions, workflows, notes)',
            },
            tag: {
              type: 'string',
              description:
                'Filter by tag — matches entries whose frontmatter tags array contains this value',
            },
          },
        },
      },
      {
        name: 'knowledge_read',
        description:
          'Read the full content of a knowledge base entry by its path (relative to the memory dir). ' +
          'Returns the raw markdown including frontmatter.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            path: {
              type: 'string',
              description: "Relative path to the entry, e.g. 'projects/my-project.md'",
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'knowledge_write',
        description:
          'Create or update a knowledge base entry. The file is written under the given category directory. ' +
          'Content should be markdown (frontmatter is optional). ' +
          'Automatically commits and pushes after writing.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            category: {
              type: 'string',
              enum: [...CATEGORIES],
              description: 'Category directory to write into',
            },
            filename: {
              type: 'string',
              description: "Filename (with or without .md extension), e.g. 'my-project.md'",
            },
            content: {
              type: 'string',
              description: 'Full markdown content for the entry',
            },
          },
          required: ['category', 'filename', 'content'],
        },
      },
      {
        name: 'knowledge_delete',
        description:
          'Delete a knowledge base entry by path. Automatically commits and pushes after deletion.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            path: {
              type: 'string',
              description: "Relative path to the entry to delete, e.g. 'notes/old-note.md'",
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'knowledge_sync',
        description:
          'Synchronize the knowledge base with the remote git repository (pull then push). ' +
          'Use this to ensure you have the latest entries from other machines/sessions.',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
      },
      {
        name: 'knowledge_sessions',
        description:
          'List sessions with metadata (timestamps, branch, message counts, preview). ' +
          'Optionally filter to a specific project. Returns sessions sorted newest first.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            project: {
              type: 'string',
              description: 'Filter by project name (substring match)',
            },
          },
        },
      },
      {
        name: 'knowledge_search',
        description:
          'Hybrid semantic + TF-IDF search across session conversations. ' +
          'Results are ranked by blended relevance (semantic similarity + keyword match) × recency. ' +
          'Use this to find past discussions, decisions, code snippets, or error messages.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: {
              type: 'string',
              description: 'Search query — supports keywords and phrases',
            },
            project: {
              type: 'string',
              description: 'Restrict search to sessions from this project',
            },
            role: {
              type: 'string',
              enum: ['user', 'assistant', 'all'],
              description: 'Filter by message role (default: all)',
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results to return (default: 20)',
            },
            ranked: {
              type: 'boolean',
              description: 'Use TF-IDF ranking (default: true). Set false for regex mode.',
            },
            semantic: {
              type: 'boolean',
              description:
                'Blend semantic vector similarity with TF-IDF (default: true). Falls back to pure TF-IDF if embeddings unavailable.',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'knowledge_get',
        description:
          'Retrieve the full conversation from a specific session. ' +
          'Optionally include tool-use messages and/or limit to the last N messages.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            session_id: {
              type: 'string',
              description: 'The session UUID to retrieve',
            },
            project: {
              type: 'string',
              description: 'Project name to narrow lookup',
            },
            include_tools: {
              type: 'boolean',
              description: 'Include tool_use and tool_result messages (default: false)',
            },
            tail: {
              type: 'number',
              description: 'Only return the last N messages from the conversation',
            },
          },
          required: ['session_id'],
        },
      },
      {
        name: 'knowledge_summary',
        description:
          'Get a concise summary of a session: topics discussed, tools used, files modified. ' +
          'Useful for quickly understanding what happened in a past session.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            session_id: {
              type: 'string',
              description: 'The session UUID to summarize',
            },
            project: {
              type: 'string',
              description: 'Project name to narrow lookup',
            },
          },
          required: ['session_id'],
        },
      },
      {
        name: 'knowledge_recall',
        description:
          'Scoped hybrid search — search within a specific domain like errors, ' +
          'plans, configs, tool usage, file references, or decisions. ' +
          'Results ranked by blended relevance (semantic + keyword) × recency. ' +
          'More targeted than knowledge_search when you know what kind of information you need.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            scope: {
              type: 'string',
              enum: [...SCOPES],
              description:
                'Search scope: errors (stack traces, exceptions), plans (architecture, TODOs), ' +
                'configs (settings, env vars), tools (MCP tool calls), ' +
                'files (file paths, code refs), decisions (trade-offs, choices), all (no filter)',
            },
            query: {
              type: 'string',
              description: 'Search query within the chosen scope',
            },
            project: {
              type: 'string',
              description: 'Restrict to sessions from this project',
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results (default: 20)',
            },
            semantic: {
              type: 'boolean',
              description:
                'Blend semantic vector similarity with TF-IDF (default: true). Falls back to pure TF-IDF if embeddings unavailable.',
            },
          },
          required: ['scope', 'query'],
        },
      },
      {
        name: 'knowledge_index_status',
        description:
          'Get vector store statistics: total entries, breakdown by source (knowledge vs session), ' +
          'database size, active embedding provider, and vector dimensions.',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
      },
      {
        name: 'knowledge_config',
        description:
          'View or update knowledge configuration. Without arguments, returns current config. ' +
          'With arguments, persists settings to knowledge-config.json. ' +
          'Set git_url to enable git sync for the knowledge base. ' +
          'Settings are persisted across restarts. Env vars override persisted values.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            git_url: {
              type: 'string',
              description:
                "Git remote URL for the knowledge base (e.g. 'https://github.com/user/memory.git'). Set to empty string to remove.",
            },
            memory_dir: {
              type: 'string',
              description:
                'Local directory for the knowledge base. Set to empty string to reset to default.',
            },
            auto_distill: {
              type: 'boolean',
              description:
                'Enable/disable automatic session distillation into the knowledge base (default: true).',
            },
          },
        },
      },
      {
        name: 'knowledge_link',
        description:
          'Create or update an edge between two knowledge entries in the knowledge graph. ' +
          'Valid relationship types: related_to, supersedes, depends_on, contradicts, specializes, part_of, alternative_to, builds_on.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            source: {
              type: 'string',
              description: "Source entry path, e.g. 'projects/my-project.md'",
            },
            target: {
              type: 'string',
              description: "Target entry path, e.g. 'decisions/architecture.md'",
            },
            rel_type: {
              type: 'string',
              enum: [...RELATIONSHIP_TYPES],
              description: 'Relationship type',
            },
            strength: {
              type: 'number',
              description: 'Edge strength between 0 and 1 (default: 0.5)',
            },
          },
          required: ['source', 'target', 'rel_type'],
        },
      },
      {
        name: 'knowledge_unlink',
        description:
          'Remove edge(s) between two knowledge entries. ' +
          'If rel_type is omitted, removes all edges between source and target.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            source: {
              type: 'string',
              description: 'Source entry path',
            },
            target: {
              type: 'string',
              description: 'Target entry path',
            },
            rel_type: {
              type: 'string',
              enum: [...RELATIONSHIP_TYPES],
              description: 'Relationship type to remove (omit to remove all)',
            },
          },
          required: ['source', 'target'],
        },
      },
      {
        name: 'knowledge_links',
        description:
          'List edges in the knowledge graph, optionally filtered by entry path and/or relationship type.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            entry: {
              type: 'string',
              description: 'Filter edges connected to this entry path',
            },
            rel_type: {
              type: 'string',
              enum: [...RELATIONSHIP_TYPES],
              description: 'Filter by relationship type',
            },
          },
        },
      },
      {
        name: 'knowledge_graph',
        description:
          'Traverse the knowledge graph via BFS from a starting entry. ' +
          'Returns all nodes and edges within the specified depth (default: 2 hops).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            entry: {
              type: 'string',
              description: 'Starting entry path for BFS traversal',
            },
            depth: {
              type: 'number',
              description: 'Maximum traversal depth in hops (default: 2)',
            },
          },
          required: ['entry'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const a = args as Record<string, unknown>;
    const config = getConfig();

    try {
      switch (name) {
        case 'knowledge_list': {
          const category = validateEnum(optionalString(a, 'category'), CATEGORIES, 'category');
          const tag = optionalString(a, 'tag');
          await gitPull(config.memoryDir);
          const entries = listEntries(config.memoryDir, category, tag);
          return ok(entries);
        }

        case 'knowledge_read': {
          const entryPath = requireString(a, 'path');
          await gitPull(config.memoryDir);
          const result = readEntry(config.memoryDir, entryPath);

          // Record access for scoring
          const scoring = getEntryScoring();
          const scoreInfo = scoring.recordAccess(entryPath);

          // Get 1-hop related entries from graph
          const graph = getKnowledgeGraph();
          const related = graph.getRelated(entryPath);

          return ok({ ...result, score: scoreInfo, related });
        }

        case 'knowledge_write': {
          const category = requireString(a, 'category');
          const filename = requireString(a, 'filename');
          const writeContent = requireString(a, 'content');
          if (writeContent.length > 1_000_000) {
            return err('Content too large (max 1MB)');
          }
          await gitPull(config.memoryDir);
          const filePath = writeEntry(config.memoryDir, category, filename, writeContent);
          const pushResult = await gitPush(config.memoryDir);

          // Index the entry for embeddings
          const autoLinks: Array<{ target: string; similarity: number }> = [];
          try {
            await indexKnowledgeEntry(filePath, writeContent);

            // Auto-link: find similar entries via vector search
            const { getEmbeddingProvider } = await import('./embeddings/index.js');
            const provider = await getEmbeddingProvider();
            if (provider) {
              const queryVector = await provider.embedOne(writeContent.slice(0, 2000));
              const vecStore = new VectorStore();
              const similar = vecStore.searchBySource(queryVector, 'knowledge', 4);
              const graphStore = getKnowledgeGraph();

              for (const hit of similar) {
                if (hit.sourceId === filePath) continue;
                if (hit.score > 0.7) {
                  graphStore.link(filePath, hit.sourceId, 'related_to', hit.score);
                  autoLinks.push({
                    target: hit.sourceId,
                    similarity: Math.round(hit.score * 100) / 100,
                  });
                }
                if (autoLinks.length >= 3) break;
              }
            }
          } catch (linkErr) {
            console.error('[knowledge] Auto-link failed:', linkErr);
          }

          const response: Record<string, unknown> = { path: filePath, git: pushResult };
          if (autoLinks.length > 0) {
            response.autoLinked = autoLinks;
            response.autoLinkMessage =
              'Auto-linked to: ' +
              autoLinks.map((l) => l.target + ' (' + l.similarity + ')').join(', ');
          }
          return ok(response);
        }

        case 'knowledge_delete': {
          const entryPath = requireString(a, 'path');
          await gitPull(config.memoryDir);
          const deleted = deleteEntry(config.memoryDir, entryPath);
          const pushResult = await gitPush(config.memoryDir);
          return ok({ deleted, git: pushResult });
        }

        case 'knowledge_sync': {
          const result = await gitSync(config.memoryDir);
          return ok(result);
        }

        case 'knowledge_sessions': {
          const project = optionalString(a, 'project');
          const sessions = listSessions(project);
          return ok(sessions);
        }

        case 'knowledge_search': {
          const query = requireString(a, 'query');
          const project = optionalString(a, 'project');
          const role =
            validateEnum(
              optionalString(a, 'role'),
              ['user', 'assistant', 'all'] as const,
              'role',
            ) ?? 'all';
          const maxResults = optionalNumber(a, 'max_results', 1, 500) ?? 20;
          const ranked = optionalBoolean(a, 'ranked') ?? true;
          const semantic = optionalBoolean(a, 'semantic') ?? true;
          const results = await searchSessions(query, {
            project,
            role,
            maxResults,
            ranked,
            semantic,
          });
          return ok(results);
        }

        case 'knowledge_get': {
          const sessionId = requireString(a, 'session_id');
          const projectFilter = optionalString(a, 'project');
          const includeTools = optionalBoolean(a, 'include_tools') ?? false;
          const tail = optionalNumber(a, 'tail', 1, 10000);

          const projects = getProjectDirs().filter(
            (p) => !projectFilter || p.name.toLowerCase().includes(projectFilter.toLowerCase()),
          );

          for (const proj of projects) {
            const sessions = getSessionFiles(proj.path);
            const match = sessions.find((s) => s.id === sessionId);
            if (match) {
              const entries = parseSessionFile(match.file);
              let messages = extractMessages(entries);
              if (!includeTools) {
                messages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
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

        case 'knowledge_summary': {
          const sessionId = requireString(a, 'session_id');
          const project = optionalString(a, 'project');
          const result = getSessionSummary(sessionId, project);
          if (!result) {
            return err(`Session ${sessionId} not found.`);
          }
          return ok(result);
        }

        case 'knowledge_recall': {
          const scope = requireString(a, 'scope');
          validateEnum(scope, SCOPES, 'scope');
          const query = requireString(a, 'query');
          const project = optionalString(a, 'project');
          const maxResults = optionalNumber(a, 'max_results', 1, 500) ?? 20;
          const semantic = optionalBoolean(a, 'semantic') ?? true;
          const results = await scopedSearch(scope as SearchScope, query, {
            project,
            maxResults,
            semantic,
          });
          return ok(results);
        }

        case 'knowledge_index_status': {
          const store = new VectorStore();
          const stats = store.stats();
          return ok(stats);
        }

        case 'knowledge_config': {
          const gitUrlArg = optionalString(a, 'git_url');
          const memoryDirArg = optionalString(a, 'memory_dir');
          const autoDistillArg = optionalBoolean(a, 'auto_distill');

          const hasUpdates =
            gitUrlArg !== undefined || memoryDirArg !== undefined || autoDistillArg !== undefined;

          if (hasUpdates) {
            const updates: Record<string, unknown> = {};
            if (gitUrlArg !== undefined) updates.gitUrl = gitUrlArg || undefined;
            if (memoryDirArg !== undefined) updates.memoryDir = memoryDirArg || undefined;
            if (autoDistillArg !== undefined) updates.autoDistill = autoDistillArg;
            savePersistedConfig(updates);

            const newConfig = getConfig();
            if (gitUrlArg && gitUrlArg.length > 0) {
              const repoResult = ensureRepo(newConfig.memoryDir, newConfig.gitUrl);
              return ok({
                message: 'Config saved',
                repoSetup: repoResult,
                config: {
                  gitUrl: newConfig.gitUrl,
                  memoryDir: newConfig.memoryDir,
                  autoDistill: newConfig.autoDistill,
                  embeddingProvider: newConfig.embeddingProvider,
                },
              });
            }

            return ok({
              message: 'Config saved',
              config: {
                gitUrl: newConfig.gitUrl,
                memoryDir: newConfig.memoryDir,
                autoDistill: newConfig.autoDistill,
                embeddingProvider: newConfig.embeddingProvider,
              },
            });
          }

          const persisted = loadPersistedConfig();
          return ok({
            active: {
              gitUrl: config.gitUrl ?? null,
              memoryDir: config.memoryDir,
              autoDistill: config.autoDistill,
              embeddingProvider: config.embeddingProvider,
              embeddingAlpha: config.embeddingAlpha,
            },
            persisted,
            configFile: getConfigLocation(),
            note: 'Config stored at a tool-agnostic location. Env vars override persisted config.',
          });
        }

        case 'knowledge_link': {
          const source = requireString(a, 'source');
          const target = requireString(a, 'target');
          const relType = requireString(a, 'rel_type');
          validateEnum(relType, RELATIONSHIP_TYPES, 'rel_type');
          const strength = optionalNumber(a, 'strength', 0, 1) ?? 0.5;
          const graphStore = getKnowledgeGraph();
          const edge = graphStore.link(source, target, relType as RelationshipType, strength);
          return ok(edge);
        }

        case 'knowledge_unlink': {
          const source = requireString(a, 'source');
          const target = requireString(a, 'target');
          const relType = validateEnum(
            optionalString(a, 'rel_type'),
            RELATIONSHIP_TYPES,
            'rel_type',
          ) as RelationshipType | undefined;
          const graphStore = getKnowledgeGraph();
          const removed = graphStore.unlink(source, target, relType);
          return ok({ removed });
        }

        case 'knowledge_links': {
          const entry = optionalString(a, 'entry');
          const relType = validateEnum(
            optionalString(a, 'rel_type'),
            RELATIONSHIP_TYPES,
            'rel_type',
          ) as RelationshipType | undefined;
          const graphStore = getKnowledgeGraph();
          const edges = graphStore.links(entry, relType);
          return ok(edges);
        }

        case 'knowledge_graph': {
          const entry = requireString(a, 'entry');
          const depth = optionalNumber(a, 'depth', 1, 10) ?? 2;
          const graphStore = getKnowledgeGraph();
          const graphResult = graphStore.graph(entry, depth);
          return ok(graphResult);
        }

        default:
          return err(`Unknown tool: ${name}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(`Error in ${name}: ${message}`);
    }
  });

  const startupConfig = getConfig();
  const repoResult = ensureRepo(startupConfig.memoryDir, startupConfig.gitUrl);
  console.error(`[knowledge] Repo init: ${repoResult.message}`);

  if (options?.isLeader !== false) {
    setTimeout(
      () =>
        backgroundIndex().catch((err) =>
          console.error('[knowledge] Background index failed:', err),
        ),
      5000,
    );
  } else {
    console.error('[knowledge] Follower instance — skipping background indexing');
  }

  return server;
}

function ok(result: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  };
}

function err(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}
