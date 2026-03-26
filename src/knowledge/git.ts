import { execFileSync } from 'child_process';

export interface GitResult {
  success: boolean;
  message: string;
}

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
