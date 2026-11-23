import { createLogger } from '@apackdev/sdk/logger'
import { watch, type FSWatcher } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { sessionJournalPath } from './sessions.ts'

const logger = createLogger('claude-print-session-cost')
const MAX_TAIL_BYTES = 256 * 1024

/** Native accounting is emitted in the journal even if the prediction has no displayable text. */
export async function readClaudePrintSessionCost(file: string, sessionId: string): Promise<number | undefined> {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    const start = Math.max(size - MAX_TAIL_BYTES, 0)
    const bytes = Buffer.alloc(size - start)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, start)
    for (let end = bytes.lastIndexOf(10, bytesRead - 1); end > 0;) {
      const boundary = bytes.lastIndexOf(10, end - 1)
      if (boundary < 0 && start > 0) break
      const line = bytes.subarray(boundary + 1, end)
      end = boundary
      if (!line.includes('"cost-state"')) continue
      try {
        const row = JSON.parse(line.toString('utf8'))
        if (row?.type === 'cost-state' && row.sessionId === sessionId
          && typeof row.totalCostUSD === 'number' && Number.isFinite(row.totalCostUSD) && row.totalCostUSD >= 0) return row.totalCostUSD
      } catch { /* A damaged row does not override the last complete accounting record. */ }
    }
  } finally { await handle.close() }
}

export function observeClaudePrintSessionCost(
  env: NodeJS.ProcessEnv,
  report: (sessionId: string, totalCostUsd: number) => void,
) {
  let scope: { sessionId: string; path: string; watcher?: FSWatcher } | undefined
  let requested = false, reading: Promise<void> | undefined
  let closing = false
  let scheduled: ReturnType<typeof setTimeout> | undefined

  function refresh(): Promise<void> {
    clearTimeout(scheduled)
    scheduled = undefined
    requested = true
    if (reading) return reading
    const drain = async () => {
      while (requested) {
        requested = false
        const selected = scope
        if (!selected) continue
        if (!closing && !selected.watcher) {
          try {
            const watcher = watch(dirname(selected.path), { persistent: false }, (_event, file) => {
              if (scope !== selected || closing || scheduled || (file && file !== basename(selected.path))) return
              scheduled = setTimeout(() => { void refresh() }, 40)
              scheduled.unref()
            })
            selected.watcher = watcher
            watcher.on('error', () => {
              watcher.close()
              if (selected.watcher === watcher) selected.watcher = undefined
            })
          } catch { /* The first native result can create the project directory. */ }
        }
        let total: number | undefined
        try { total = await readClaudePrintSessionCost(selected.path, selected.sessionId) }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.debug('Could not read the native cost journal', { sessionId: selected.sessionId, error })
        }
        if (scope === selected && total !== undefined) {
          try { report(selected.sessionId, total) }
          catch (error) { logger.warn('Could not publish the native session cost', { sessionId: selected.sessionId, error }) }
        }
      }
    }
    reading = Promise.resolve().then(drain).finally(() => {
      reading = undefined
      if (requested) return refresh()
    })
    return reading
  }

  return {
    select(sessionId?: string, cwd?: string) {
      if (closing) return
      const path = sessionId && cwd && /^[a-f0-9-]{36}$/i.test(sessionId) ? sessionJournalPath(sessionId, cwd, env) : undefined
      if (scope?.path === path) return
      scope?.watcher?.close()
      scope = path && sessionId ? { sessionId, path } : undefined
      if (scope) void refresh()
    },
    refresh,
    async close() {
      closing = true
      scope?.watcher?.close()
      await refresh()
      scope = undefined
    },
  }
}
