import { homedir } from "os";
import { join } from "path";

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
