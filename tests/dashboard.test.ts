import { describe, it, expect, afterAll } from 'vitest';
import http from 'http';
import { startDashboard } from '../src/dashboard.js';

// Use a random high port to avoid conflicts
const TEST_PORT = 19423 + Math.floor(Math.random() * 1000);
let server: http.Server;

function fetch(path: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${TEST_PORT}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body: data, headers: res.headers }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

describe('dashboard HTTP server', () => {
  // Start server once for all tests
  it('starts on the given port', async () => {
    server = await startDashboard(TEST_PORT);
    expect(server).toBeDefined();
    expect(server.listening).toBe(true);
  });

  afterAll(() => {
    if (server) server.close();
  });

  it('GET /health returns JSON with status ok', async () => {
    const { status, body } = await fetch('/health');
    expect(status).toBe(200);
    const data = JSON.parse(body);
    expect(data.status).toBe('ok');
    expect(data.version).toBeDefined();
    expect(typeof data.uptime).toBe('number');
  });

  it('GET /api/knowledge returns array', async () => {
    const { status, body } = await fetch('/api/knowledge');
    expect(status).toBe(200);
    const data = JSON.parse(body);
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/sessions returns array', async () => {
    const { status, body } = await fetch('/api/sessions');
    expect(status).toBe(200);
    const data = JSON.parse(body);
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/sessions/search returns array', async () => {
    const { status, body } = await fetch('/api/sessions/search?q=test');
    expect(status).toBe(200);
    const data = JSON.parse(body);
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/sessions/recall returns array', async () => {
    const { status, body } = await fetch('/api/sessions/recall?scope=errors&q=test');
    expect(status).toBe(200);
    const data = JSON.parse(body);
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/knowledge/search returns array', async () => {
    const { status, body } = await fetch('/api/knowledge/search?q=test');
    expect(status).toBe(200);
    const data = JSON.parse(body);
    expect(Array.isArray(data)).toBe(true);
  });

  it('returns 404 for non-existent session', async () => {
    const { status } = await fetch('/api/sessions/nonexistent-id-12345');
    expect(status).toBe(404);
  });

  it('returns 404 for non-existent session summary', async () => {
    const { status } = await fetch('/api/sessions/nonexistent-id-12345/summary');
    expect(status).toBe(404);
  });

  it('returns CORS headers on responses', async () => {
    const { headers } = await fetch('/health');
    expect(headers['access-control-allow-origin']).toBe('*');
  });

  it('serves static files for root path', async () => {
    const { status, headers } = await fetch('/');
    // May be 200 (if UI dir exists) or 404
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(headers['content-type']).toContain('text/html');
    }
  });

  it('rejects non-GET methods with 405', async () => {
    return new Promise<void>((resolve, reject) => {
      const req = http.request(
        { hostname: 'localhost', port: TEST_PORT, path: '/health', method: 'POST' },
        (res) => {
          expect(res.statusCode).toBe(405);
          res.resume();
          resolve();
        },
      );
      req.on('error', reject);
      req.end();
    });
  });

  it('allows OPTIONS requests (CORS preflight)', async () => {
    return new Promise<void>((resolve, reject) => {
      const req = http.request(
        { hostname: 'localhost', port: TEST_PORT, path: '/api/knowledge', method: 'OPTIONS' },
        (res) => {
          expect(res.statusCode).toBe(204);
          expect(res.headers['access-control-allow-origin']).toBe('*');
          res.resume();
          resolve();
        },
      );
      req.on('error', reject);
      req.end();
    });
  });
});
