import { homedir } from "os";
import { join } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

export interface CortexConfig {
  memoryDir: string;
  claudeDir: string;
  projectsDir: string;
}

export function getConfig(): CortexConfig {
  const home = homedir();
  const claudeDir = process.env.CLAUDE_DIR || join(home, ".claude");
  const memoryDir =
    process.env.CORTEX_MEMORY_DIR ||
    process.env.CLAUDE_MEMORY_DIR ||
    join(home, "claude-memory");
  const projectsDir = join(claudeDir, "projects");

  return { memoryDir, claudeDir, projectsDir };
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
