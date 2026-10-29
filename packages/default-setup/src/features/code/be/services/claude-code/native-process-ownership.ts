import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
/** A configured launcher may host the native executable beneath its PTY process. */
export async function isClaudeNativeDescendant(pid: number, ownerPid: number | undefined, parent = async (value: number) => {
  try { const { stdout } = await exec('/bin/ps', ['-p', String(value), '-o', 'ppid='], { timeout: 1000 }); return Number(stdout.trim()) } catch { return 0 }
}): Promise<boolean> {
  if (!ownerPid || !Number.isSafeInteger(pid) || pid < 2) return false
  const seen = new Set<number>()
  for (let depth = 0; depth < 16 && pid > 1 && !seen.has(pid); depth++) {
    if (pid === ownerPid) return true
    seen.add(pid); pid = await parent(pid)
  }
  return false
}
