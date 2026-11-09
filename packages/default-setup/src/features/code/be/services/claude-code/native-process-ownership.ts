import { execFileWhileWorking } from '@apackdev/sdk/progress'
/** A configured launcher may host the native executable beneath its PTY process. */
export async function isClaudeNativeDescendant(pid: number, ownerPid: number | undefined, parent = async (value: number) => {
  // Bounded by what `ps` spends rather than by a second of wall clock: a loaded machine takes longer
  // than that to schedule it, and a walk that gave up would read as "no owner" and leak the tree
  try { const { stdout } = await execFileWhileWorking('/bin/ps', ['-p', String(value), '-o', 'ppid='], { timeout: 1000 }); return Number(stdout.trim()) } catch { return 0 }
}): Promise<boolean> {
  if (!ownerPid || !Number.isSafeInteger(pid) || pid < 2) return false
  const seen = new Set<number>()
  for (let depth = 0; depth < 16 && pid > 1 && !seen.has(pid); depth++) {
    if (pid === ownerPid) return true
    seen.add(pid); pid = await parent(pid)
  }
  return false
}
