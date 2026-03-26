import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import type { ProviderName } from "./embeddings/types.js";

export interface CortexConfig {
  memoryDir: string;
  claudeDir: string;
  projectsDir: string;
  embeddingProvider: ProviderName;
  embeddingAlpha: number;
  gitUrl: string | undefined;
  autoDistill: boolean;
}

// ── Persistent config file (~/.config/cortex/config.json) ───────────────────

export interface PersistedConfig {
  gitUrl?: string;
  memoryDir?: string;
  autoDistill?: boolean;
  embeddingProvider?: string;
  embeddingAlpha?: number;
}

function getConfigDir(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "cortex");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "cortex");
}

function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function getConfigLocation(): string {
  return getConfigPath();
}

export function loadPersistedConfig(): PersistedConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

export function savePersistedConfig(updates: Partial<PersistedConfig>): PersistedConfig {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  const existing = loadPersistedConfig();
  const merged = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === null || value === "") {
      delete (merged as Record<string, unknown>)[key];
    } else {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2) + "\n", "utf-8");
  return merged;
}

// ── Config resolution (env vars > persisted config > defaults) ──────────────

export function getConfig(): CortexConfig {
  const home = homedir();
  const claudeDir = process.env.CLAUDE_DIR || join(home, ".claude");
  const persisted = loadPersistedConfig();

  const memoryDir =
    process.env.CORTEX_MEMORY_DIR ||
    process.env.CLAUDE_MEMORY_DIR ||
    persisted.memoryDir ||
    join(home, "claude-memory");
  const projectsDir = join(claudeDir, "projects");
  const embeddingProvider =
    (process.env.CORTEX_EMBEDDING_PROVIDER as ProviderName) ||
    (persisted.embeddingProvider as ProviderName) ||
    "local";
  const embeddingAlpha = parseFloat(
    process.env.CORTEX_EMBEDDING_ALPHA || String(persisted.embeddingAlpha ?? 0.3),
  );
  const gitUrl = process.env.CORTEX_GIT_URL || persisted.gitUrl || undefined;
  const autoDistillEnv = process.env.CORTEX_AUTO_DISTILL;
  const autoDistill = autoDistillEnv !== undefined
    ? autoDistillEnv.toLowerCase() !== "false"
    : (persisted.autoDistill ?? true);

  return { memoryDir, claudeDir, projectsDir, embeddingProvider, embeddingAlpha, gitUrl, autoDistill };
}

let _version: string | null = null;

/**
 * Read the version from package.json (cached after first call).
 */
export function getVersion(): string {
  if (_version) return _version;
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const thisDir = dirname(thisFile);
    // Try src/../package.json then dist/../package.json
    for (const rel of [join(thisDir, "..", "package.json"), join(thisDir, "..", "..", "package.json")]) {
      try {
        const pkg = JSON.parse(readFileSync(rel, "utf-8"));
        if (pkg.version) {
          _version = String(pkg.version);
          return _version;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // fallback
  }
  _version = "1.0.0";
  return _version;
}
