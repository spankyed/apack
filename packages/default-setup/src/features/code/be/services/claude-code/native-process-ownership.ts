import { execFileWhileWorking } from '@apackdev/sdk/progress'
/** A configured launcher may host the native executable beneath its PTY process. */
/**
 * Whether `pid` is `ownerPid` or something it started, by asking the OS for each parent in turn.
 *
 * **For a process this one spawned, and nothing else.** A pid inside a *terminal session's* tree is that
 * session's own question — `services.terminal`'s `owns`, answered by the host that owns the tree with the
 * same walk it refuses a signal with. Asking here about one of those would be a second implementation of
 * that invariant, free to disagree with it, and off POSIX it answers `false` for everything because there
 * is no `ps` to ask: a caller cannot tell that from a genuine *no*.
 *
 * What is left for this is the print client's launcher, which this process spawned itself: there is no
 * session to ask, and the claim it guards — a pid arriving over that client's own socket — is the same
 * shape of authorization decision.
 */
export async function isDescendantOfOurChild(pid: number, ownerPid: number | undefined, parent = async (value: number) => {
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
