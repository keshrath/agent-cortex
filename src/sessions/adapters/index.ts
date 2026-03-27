import type { SessionEntry } from '../parser.js';

export interface SessionAdapter {
  /** Unique prefix for virtual descriptors (e.g. "opencode", "cline") */
  prefix: string;
  /** Human-readable name */
  name: string;
  /** Check if this source is available on this machine */
  isAvailable(): boolean;
  /** Discover projects/groups */
  discoverProjects(): Array<{ name: string; path: string }>;
  /** List sessions within a project */
  listSessions(projectDescriptor: string): Array<{ id: string; file: string }>;
  /** Parse a session into normalized SessionEntry[] */
  parseSession(descriptor: string): SessionEntry[];
}

const adapters: SessionAdapter[] = [];

export function registerAdapter(adapter: SessionAdapter): void {
  if (!adapters.find((a) => a.prefix === adapter.prefix)) {
    adapters.push(adapter);
  }
}

export function getAvailableAdapters(): SessionAdapter[] {
  return adapters.filter((a) => {
    try {
      return a.isAvailable();
    } catch {
      return false;
    }
  });
}

export function initAdapters(): void {
  import('./opencode.js').then((m) => registerAdapter(m.openCodeAdapter)).catch(() => {});
  import('./cline.js').then((m) => registerAdapter(m.clineAdapter)).catch(() => {});
}
