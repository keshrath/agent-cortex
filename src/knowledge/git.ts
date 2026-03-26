import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface GitResult {
  success: boolean;
  message: string;
}

const CATEGORIES = ['projects', 'people', 'decisions', 'workflows', 'notes'];

/**
 * Run a git command safely using execFileSync (no shell).
 */
function execGit(args: string[], cwd: string, timeout: number): string {
  try {
    const output = execFileSync('git', args, {
      cwd,
      stdio: 'pipe',
      timeout,
    });
    return output ? output.toString().trim() : '';
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer; message?: string };
    const msg = e.stderr ? e.stderr.toString().trim() : (e.message ?? String(err));
    throw new Error(`git ${args[0]} failed: ${msg}`);
  }
}

/**
 * Pull latest changes from remote with rebase.
 */
export async function gitPull(dir: string): Promise<GitResult> {
  try {
    const output = execGit(['pull', '--rebase', '--quiet'], dir, 15_000);
    return { success: true, message: output || 'up to date' };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? (err as Error).message : String(err) };
  }
}

/**
 * Stage all changes, commit if dirty, and push.
 * Only commits when there are staged changes.
 */
export async function gitPush(dir: string, commitMsg?: string): Promise<GitResult> {
  const message = commitMsg ?? 'update knowledge base';
  try {
    execGit(['add', '-A'], dir, 5_000);

    // Only commit if there are staged changes
    try {
      execGit(['diff', '--cached', '--quiet'], dir, 5_000);
      // No error means no changes — skip commit
    } catch {
      // diff --cached --quiet exits non-zero when there ARE changes
      execGit(['commit', '-m', message], dir, 5_000);
    }

    execGit(['push', '--quiet'], dir, 15_000);
    return { success: true, message: 'pushed successfully' };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? (err as Error).message : String(err) };
  }
}

/**
 * Pull then push — full bidirectional sync.
 */
export async function gitSync(dir: string): Promise<{ pull: GitResult; push: GitResult }> {
  const pull = await gitPull(dir);
  const push = await gitPush(dir);
  return { pull, push };
}

/**
 * Ensure the memory directory exists and is a git repo.
 *
 * - If dir missing + gitUrl set → clone
 * - If dir exists but not a git repo + gitUrl set → init + remote add + initial commit
 * - If dir missing + no gitUrl → create local-only dir with category folders
 * - If dir exists + is a git repo → no-op
 */
export function ensureRepo(dir: string, gitUrl?: string): GitResult {
  const isGitRepo = existsSync(join(dir, '.git'));

  if (isGitRepo) {
    return { success: true, message: 'repo already exists' };
  }

  if (!existsSync(dir) && gitUrl) {
    // Clone the remote repo
    try {
      execGit(['clone', gitUrl, dir], process.cwd(), 30_000);
      return { success: true, message: `cloned ${gitUrl} into ${dir}` };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  // Ensure the directory exists with category subdirs
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  for (const cat of CATEGORIES) {
    const catDir = join(dir, cat);
    if (!existsSync(catDir)) {
      mkdirSync(catDir, { recursive: true });
    }
  }

  if (gitUrl) {
    try {
      execGit(['init'], dir, 5_000);
      execGit(['remote', 'add', 'origin', gitUrl], dir, 5_000);
      execGit(['add', '-A'], dir, 5_000);
      try {
        execGit(['commit', '-m', 'init knowledge base'], dir, 5_000);
      } catch { /* no files to commit is fine */ }
      try {
        execGit(['push', '-u', 'origin', 'HEAD', '--quiet'], dir, 15_000);
      } catch { /* remote may have existing content — pull first next time */ }
      return { success: true, message: `initialized repo with remote ${gitUrl}` };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  return { success: true, message: 'created local-only memory directory (no git URL configured)' };
}
