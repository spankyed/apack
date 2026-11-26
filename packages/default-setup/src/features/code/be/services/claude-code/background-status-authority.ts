import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnStream, type StreamHandle, type SpawnStreamOptions } from './runner.ts'
import { claudeNativePlatformRuntime, rewriteClaudeNativePlatformSelectors } from './native-platform-runtime.ts'
import { claudeTerminalBackgroundStatusRuntime } from './terminal-background-status-runtime.ts'
import type { ClaudeBackgroundStatusIdentity } from './terminal-background-status.ts'

/** A read-only original runtime owns identity checks independently of the parent's UI socket. */
export function createClaudeBackgroundStatusAuthority(parentSessionId: string, options: SpawnStreamOptions) {
  const abort = new AbortController()
  const pending = new Map<string, { resolve(value: ClaudeBackgroundStatusIdentity): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  let ready = false, readyResolve: (() => void) | undefined, readyReject: ((error: Error) => void) | undefined
  let closed = false, directory: string | undefined, handle: StreamHandle | undefined, opening: Promise<StreamHandle> | undefined
  const rejectPending = (error: Error) => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error) }
    pending.clear(); readyReject?.(error)
  }
  const end = async () => {
    closed = true; abort.abort(); rejectPending(new Error('Background status authority closed'))
    try { await opening } catch { /* Failed startup has no live authority. */ }
    if (handle) { handle.endInput(); await handle.done() }
    if (directory) await rm(directory, { recursive: true, force: true })
  }
  async function open() {
    directory = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'cc-status-'))
    const preload = join(directory, 'authority.mjs')
    const source = `import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {createInterface} from 'node:readline';
const config={sessionId:${JSON.stringify(parentSessionId)}};
const originalBunOptions=${JSON.stringify(options.env?.BUN_OPTIONS ?? null)};
if(originalBunOptions===null)delete process.env.BUN_OPTIONS;else process.env.BUN_OPTIONS=originalBunOptions;
${claudeNativePlatformRuntime}
${rewriteClaudeNativePlatformSelectors(claudeTerminalBackgroundStatusRuntime)}
requireClaudeNativePlatform();
await importClaudeNativeModule('chunk-tj6zgtfh.js');await importClaudeNativeModule('chunk-0xj14bee.js');
const requests=(async()=>{for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
 if(line.length>4096)throw Error('Background identity request exceeds bound');
 const request=JSON.parse(line);
 if(typeof request.id!=='string'||request.id.length>64)throw Error('Invalid background identity request');
 try{const value=await identifyNativeBackground(request);process.stdout.write(JSON.stringify({id:request.id,value})+'\\n');}
 catch{process.stdout.write(JSON.stringify({id:request.id,error:'Original background identity refused'})+'\\n');}
}})();
process.stdout.write(JSON.stringify({ready:true})+'\\n');
await requests;process.exit(0);`
    await writeFile(preload, source, { mode: 0o600 })
    if (closed) throw new Error('Background status authority closed')
    const env = { ...options.env, BUN_OPTIONS: (options.env?.BUN_OPTIONS ? options.env.BUN_OPTIONS + ' ' : '') + '--preload=' + preload }
    handle = await spawnStream(['--version'], { ...options, env, signal: abort.signal })
    if (closed) { handle.kill(); throw new Error('Background status authority closed') }
    const prepared = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
    const startupTimer = setTimeout(() => { readyReject?.(new Error('Background status authority startup timed out')); abort.abort() }, 15000)
    startupTimer.unref()
    void consume(handle)
    try { await prepared } finally { clearTimeout(startupTimer); readyResolve = undefined; readyReject = undefined }
    return handle
  }
  async function consume(current: StreamHandle) {
    try {
      for await (const line of current.lines) {
        if (closed) break
        if (!line.ok) throw new Error('Invalid background identity response')
        const row = line.value as { ready?: unknown; id?: unknown; value?: ClaudeBackgroundStatusIdentity; error?: unknown }
        if (row?.ready === true && !ready) { ready = true; readyResolve?.(); continue }
        if (!ready || !row || typeof row.id !== 'string') throw new Error('Invalid background identity response')
        const request = pending.get(row.id)
        if (!request) continue
        pending.delete(row.id); clearTimeout(request.timer)
        if (row.error || !row.value) request.reject(new Error('Original background identity refused'))
        else request.resolve(row.value)
      }
    } catch { /* The owned authority is retired on malformed output or transport loss. */ }
    finally {
      closed = true; abort.abort(); rejectPending(new Error('Background status authority unavailable'))
      await current.done()
      if (directory) await rm(directory, { recursive: true, force: true })
    }
  }
  return {
    async identify(sessionId: string, pid: number, cwd: string): Promise<ClaudeBackgroundStatusIdentity> {
      if (closed || pending.size >= 16) throw new Error('Background status authority unavailable')
      const current = await (opening ??= open().catch(async error => {
        closed = true; abort.abort(); rejectPending(new Error('Background status authority unavailable'))
        if (directory) await rm(directory, { recursive: true, force: true })
        throw error
      }))
      if (closed || pending.size >= 16) throw new Error('Background status authority unavailable')
      return new Promise((resolve, reject) => {
        const id = randomUUID()
        const timer = setTimeout(() => {
          pending.delete(id); reject(new Error('Background status identity timed out'))
          void end()
        }, 3000)
        timer.unref()
        pending.set(id, { resolve, reject, timer })
        if (!current.write({ id, parent_session_id: parentSessionId, child_session_id: sessionId, pid, cwd })) {
          pending.delete(id); clearTimeout(timer); reject(new Error('Background status authority input closed')); void end()
        }
      })
    },
    close: end,
  }
}
