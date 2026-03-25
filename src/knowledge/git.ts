import { execSync } from 'child_process';

export interface GitResult {
  success: boolean;
  message: string;
}

function execGit(cmd: string, cwd: string, timeout: number): string {
  try {
    const output = execSync(cmd, {
      cwd,
      stdio: 'pipe',
      timeout,
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    return output ? output.toString().trim() : '';
  } catch (err: any) {
    const msg = err.stderr ? err.stderr.toString().trim() : err.message;
    throw new Error(`"${cmd}" failed: ${msg}`);
  }
}

/**
 * Pull latest changes from remote with rebase.
 */
export async function gitPull(dir: string): Promise<GitResult> {
  try {
    const output = execGit('git pull --rebase --quiet', dir, 15_000);
    return { success: true, message: output || 'up to date' };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

/**
 * Stage all changes, commit if dirty, and push.
 * Only commits when there are staged changes.
 */
export async function gitPush(dir: string, commitMsg?: string): Promise<GitResult> {
  const message = commitMsg ?? 'update knowledge base';
  try {
    execGit('git add -A', dir, 5_000);

    // Only commit if there are staged changes
    try {
      execGit('git diff --cached --quiet', dir, 5_000);
      // No error means no changes — skip commit
    } catch {
      // diff --cached --quiet exits non-zero when there ARE changes
      execGit(`git commit -m "${message.replace(/"/g, '\\"')}"`, dir, 5_000);
    }

    execGit('git push --quiet', dir, 15_000);
    return { success: true, message: 'pushed successfully' };
  } catch (err: any) {
    return { success: false, message: err.message };
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
