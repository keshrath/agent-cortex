import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { listEntries, readEntry } from './knowledge/store.js';
import { searchKnowledge } from './knowledge/search.js';
import {
  getProjectDirs,
  getSessionFiles,
  parseSessionFile,
  extractMessages,
  getSessionMeta,
} from './sessions/parser.js';
import { searchSessions } from './sessions/search.js';
import { listSessions, getSessionSummary } from './sessions/summary.js';
import { scopedSearch, type SearchScope } from './sessions/scopes.js';
import { VectorStore } from './vectorstore/index.js';
import { getConfig } from './types.js';
import { getVersion } from './version.js';

const VERSION = getVersion();
const DEFAULT_PORT = 3423;
const HEARTBEAT_INTERVAL = 30_000;
const MAX_WS_CONNECTIONS = 50;
const MAX_WS_MESSAGE_SIZE = 4096;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function resolveUiDir(): string {
  const moduleUrl = new URL(import.meta.url);
  let moduleDir: string;
  if (process.platform === 'win32') {
    moduleDir = moduleUrl.pathname.replace(/^\/([a-zA-Z]:)/, '$1');
  } else {
    moduleDir = moduleUrl.pathname;
  }
  moduleDir = path.dirname(moduleDir);

  const srcUi = path.resolve(moduleDir, 'ui');
  if (fs.existsSync(srcUi)) return srcUi;

  const distUi = path.resolve(moduleDir, '..', 'dist', 'ui');
  if (fs.existsSync(distUi)) return distUi;

  return srcUi;
}

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function errorResponse(res: http.ServerResponse, message: string, status = 500): void {
  jsonResponse(res, { error: message }, status);
}

function serveStatic(uiDir: string, reqPath: string, res: http.ServerResponse): void {
  const filePath = reqPath === '/' ? '/index.html' : reqPath;

  // Decode and reject path traversal attempts
  let decoded: string;
  try {
    decoded = decodeURIComponent(filePath);
  } catch {
    errorResponse(res, 'Bad request', 400);
    return;
  }

  if (decoded.includes('\0') || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(decoded)) {
    errorResponse(res, 'Forbidden', 403);
    return;
  }

  const resolved = path.resolve(uiDir, '.' + decoded);

  // Use realpathSync to resolve symlinks for robust traversal check
  let realBase: string;
  try {
    realBase = fs.realpathSync(uiDir);
  } catch {
    errorResponse(res, 'Not found', 404);
    return;
  }

  if (!resolved.startsWith(realBase)) {
    errorResponse(res, 'Forbidden', 403);
    return;
  }

  // Also verify the actual resolved file (after symlink resolution)
  let realFilePath: string;
  try {
    realFilePath = fs.realpathSync(resolved);
  } catch {
    realFilePath = resolved;
  }
  if (!realFilePath.startsWith(realBase)) {
    errorResponse(res, 'Forbidden', 403);
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(resolved, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        errorResponse(res, 'Not found', 404);
      } else {
        errorResponse(res, 'Internal server error', 500);
      }
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
        "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
        "connect-src 'self' ws: wss:",
        "img-src 'self' data:",
      ].join('; '),
    });
    res.end(data);
  });
}

async function handleApi(pathname: string, url: URL, res: http.ServerResponse): Promise<boolean> {
  const config = getConfig();
  const memoryDir = config.memoryDir;

  try {
    if (pathname === '/health') {
      const entries = listEntries(memoryDir);
      const sessions = listSessions();
      jsonResponse(res, {
        status: 'ok',
        version: VERSION,
        uptime: process.uptime(),
        knowledge_entries: entries.length,
        sessions: sessions.length,
      });
      return true;
    }

    if (pathname === '/api/index-status') {
      try {
        const store = new VectorStore();
        const stats = store.stats();
        jsonResponse(res, stats);
      } catch {
        jsonResponse(res, {
          totalEntries: 0,
          knowledgeEntries: 0,
          sessionEntries: 0,
          dbSizeMB: 0,
          provider: null,
          dimensions: 0,
        });
      }
      return true;
    }

    if (pathname === '/api/knowledge/search') {
      const q = url.searchParams.get('q') || '';
      const category = url.searchParams.get('category') || undefined;
      const maxResults = url.searchParams.get('max_results');
      const results = searchKnowledge(memoryDir, q, {
        category,
        maxResults: maxResults ? parseInt(maxResults, 10) : undefined,
      });
      jsonResponse(res, results);
      return true;
    }

    if (pathname === '/api/knowledge') {
      const category = url.searchParams.get('category') || undefined;
      const tag = url.searchParams.get('tag') || undefined;
      const entries = listEntries(memoryDir, category, tag);
      jsonResponse(res, entries);
      return true;
    }

    if (pathname.startsWith('/api/knowledge/')) {
      const entryPath = decodeURIComponent(pathname.slice('/api/knowledge/'.length));
      if (entryPath) {
        const entry = readEntry(memoryDir, entryPath);
        jsonResponse(res, entry);
        return true;
      }
    }

    if (pathname === '/api/sessions/search') {
      const q = url.searchParams.get('q') || '';
      const role = url.searchParams.get('role') || 'all';
      const maxResults = url.searchParams.get('max_results');
      const ranked = url.searchParams.get('ranked') !== 'false';
      const project = url.searchParams.get('project') || undefined;
      const results = await searchSessions(q, {
        role: role as 'user' | 'assistant' | 'all',
        maxResults: maxResults ? parseInt(maxResults, 10) : 20,
        ranked,
        project,
      });
      jsonResponse(res, results);
      return true;
    }

    if (pathname === '/api/sessions/recall') {
      const scope = (url.searchParams.get('scope') || 'all') as SearchScope;
      const q = url.searchParams.get('q') || '';
      const maxResults = url.searchParams.get('max_results');
      const project = url.searchParams.get('project') || undefined;
      const results = await scopedSearch(scope, q, {
        maxResults: maxResults ? parseInt(maxResults, 10) : 20,
        project,
      });
      jsonResponse(res, results);
      return true;
    }

    if (pathname === '/api/sessions') {
      const project = url.searchParams.get('project') || undefined;
      const sessions = listSessions(project);
      jsonResponse(res, sessions);
      return true;
    }

    const sessionSummaryMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/summary$/);
    if (sessionSummaryMatch) {
      const sessionId = decodeURIComponent(sessionSummaryMatch[1]);
      const project = url.searchParams.get('project') || undefined;
      const summary = getSessionSummary(sessionId, project);
      if (!summary) {
        errorResponse(res, `Session ${sessionId} not found`, 404);
      } else {
        jsonResponse(res, summary);
      }
      return true;
    }

    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      const project = url.searchParams.get('project') || undefined;
      const includeTools = url.searchParams.get('include_tools') === 'true';
      const tailParam = url.searchParams.get('tail');
      const tail = tailParam ? parseInt(tailParam, 10) : undefined;

      const projects = getProjectDirs().filter(
        (p) => !project || p.name.toLowerCase().includes(project.toLowerCase()),
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
          jsonResponse(res, { meta, messages });
          return true;
        }
      }

      errorResponse(res, `Session ${sessionId} not found`, 404);
      return true;
    }

    return false;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    errorResponse(res, message, 500);
    return true;
  }
}

interface ExtWebSocket extends WebSocket {
  isAlive?: boolean;
}

const wsClients: Set<ExtWebSocket> = new Set();

function wsBroadcast(data: unknown): void {
  const payload = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

async function buildStateSnapshot(): Promise<object> {
  const config = getConfig();
  try {
    const knowledge = listEntries(config.memoryDir);
    const sessions = listSessions();
    return {
      type: 'state',
      knowledge: knowledge || [],
      sessions: sessions || [],
      stats: {
        knowledge_entries: knowledge.length,
        session_count: sessions.length,
        uptime: process.uptime(),
        version: VERSION,
      },
    };
  } catch {
    return {
      type: 'state',
      knowledge: [],
      sessions: [],
      stats: { knowledge_entries: 0, session_count: 0, uptime: process.uptime(), version: VERSION },
    };
  }
}

export async function notifyUpdate(): Promise<void> {
  if (wsClients.size === 0) return;
  const state = await buildStateSnapshot();
  wsBroadcast(state);
}

export function startDashboard(port?: number): Promise<http.Server> {
  const listenPort = port ?? DEFAULT_PORT;
  const uiDir = resolveUiDir();

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const reqUrl = req.url || '/';

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      if (req.method !== 'GET') {
        errorResponse(res, 'Method not allowed', 405);
        return;
      }

      let url: URL;
      try {
        url = new URL(reqUrl, `http://${req.headers.host || 'localhost'}`);
      } catch {
        errorResponse(res, 'Bad request', 400);
        return;
      }

      const pathname = url.pathname;

      if (pathname.startsWith('/api/') || pathname === '/health') {
        const handled = await handleApi(pathname, url, res);
        if (handled) return;
      }

      if (!pathname.startsWith('/api/')) {
        serveStatic(uiDir, pathname, res);
        return;
      }

      errorResponse(res, 'Not found', 404);
    });

    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_SIZE });

    server.on('upgrade', (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });

    wss.on('connection', async (ws: ExtWebSocket) => {
      if (wsClients.size >= MAX_WS_CONNECTIONS) {
        ws.close(1013, 'Too many connections');
        return;
      }
      ws.isAlive = true;
      wsClients.add(ws);

      ws.on('pong', () => {
        ws.isAlive = true;
      });
      ws.on('close', () => {
        wsClients.delete(ws);
      });
      ws.on('error', () => {
        wsClients.delete(ws);
      });

      try {
        const state = await buildStateSnapshot();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(state));
        }
      } catch {
        // non-fatal
      }
    });

    const heartbeat = setInterval(() => {
      for (const ws of wsClients) {
        if (ws.isAlive === false) {
          wsClients.delete(ws);
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, HEARTBEAT_INTERVAL);

    // ── File Watcher (live reload) ──────────────────────────────────────
    let reloadDebounce: ReturnType<typeof setTimeout> | null = null;
    let fileWatcher: fs.FSWatcher | null = null;

    function broadcastReload(): void {
      if (reloadDebounce) clearTimeout(reloadDebounce);
      reloadDebounce = setTimeout(() => {
        wsBroadcast({ type: 'reload' });
      }, 200);
    }

    try {
      if (fs.existsSync(uiDir)) {
        fileWatcher = fs.watch(uiDir, { recursive: true }, (eventType, filename) => {
          if (filename && /\.(html|css|js)$/.test(filename)) {
            broadcastReload();
          }
        });
      }
    } catch {
      // file watching not available on this platform — non-fatal
    }

    server.on('close', () => {
      clearInterval(heartbeat);
      if (fileWatcher) fileWatcher.close();
      wss.close();
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${listenPort} already in use`));
      } else {
        reject(err);
      }
    });

    server.listen(listenPort, () => {
      resolve(server);
    });
  });
}
