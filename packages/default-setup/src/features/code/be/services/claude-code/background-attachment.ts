import {access, stat} from 'node:fs/promises'
import {constants} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {resolveForService} from '../../utils/resolve-cli.ts'
import {buildChildEnv} from './runner.ts'
import {backgroundSession} from './background-sessions.ts'
import type {SubcommandOptions} from './subcommand.ts'
import type {ClaudeNativeContinuation} from './terminal-session.ts'
import type {ClaudeBackgroundAttachmentSnapshot} from '../../../common/native-background.ts'

export interface ClaudeBackgroundAttachment {
  readonly snapshot: ClaudeBackgroundAttachmentSnapshot
  subscribe(listener: () => void): () => void
  input(id: string, text: string): boolean
  resize(id: string, columns: number, rows: number): boolean
  close(): Promise<void>
}

/** Own the original attach client; never send Stop to its background worker on close. */
export async function openBackgroundAttachment(continuation: ClaudeNativeContinuation, jobId: string, options: SubcommandOptions = {}): Promise<ClaudeBackgroundAttachment> {
  if (process.platform === 'win32') throw new Error('Native background attachment currently requires a POSIX terminal')
  if (options.signal?.aborted) throw new Error('Background attachment cancelled')
  const session = await backgroundSession(continuation, {operation: 'refresh'}, options)
  if (!session || session.id !== jobId || session.sessionId !== continuation.continuedInSessionId) throw new Error('Background session changed; refresh before opening it')
  const executable = options.cliPath ?? await resolveForService('claude-code')
  await access(executable, constants.X_OK)
  if (!(await stat(session.cwd)).isDirectory()) throw new Error('Background session directory is unavailable')
  if (options.signal?.aborted) throw new Error('Background attachment cancelled')
  // Content bundle loading must not load the native driver.
  const pty = await import('node-pty')
  if (options.signal?.aborted) throw new Error('Background attachment cancelled')
  const env: Record<string,string> = {}
  for (const [key,value] of Object.entries(buildChildEnv(options.env))) if (typeof value === 'string') env[key] = value
  const client = pty.spawn(executable, ['attach', session.id], {cwd: session.cwd, env, name: 'xterm-256color', cols: 100, rows: 30})
  const id = randomUUID(), listeners = new Set<() => void>(), chunks: {sequence:number;text:string}[] = []
  let ended = false, closing = false, sequence = 0, bytes = 0, exitCode: number | undefined, hardStop: ReturnType<typeof setTimeout> | undefined
  let finish!: () => void
  const done = new Promise<void>(resolve => {finish = resolve})
  const changed = () => {for (const listener of listeners) {try {listener()} catch { /* isolate windows */ }}}
  const signal = (name: NodeJS.Signals) => {if (client.pid > 1 && client.pid !== process.pid) {try {process.kill(-client.pid, name)} catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error}}}
  const close = async () => {
    if (!ended && !closing) {
      closing = true
      signal('SIGTERM')
      if (!ended) hardStop = setTimeout(() => {if (!ended) {try {signal('SIGKILL')} catch { /* owned client already gone */ }}}, 2000)
      hardStop?.unref()
    }
    return done
  }
  const abort = () => {void close().catch(() => {})}
  const data = client.onData(text => {
    if (ended) return
    const raw = Buffer.from(text), tail = raw.subarray(Math.max(0, raw.length - 262144))
    let start = 0; while (start < tail.length && (tail[start]! & 0xc0) === 0x80) start++
    const value = tail.subarray(start).toString('utf8')
    chunks.push({sequence: ++sequence, text: value}); bytes += Buffer.byteLength(value)
    while (chunks.length > 1 && (bytes > 1048576 || chunks.length > 512)) bytes -= Buffer.byteLength(chunks.shift()!.text)
    changed()
  })
  client.onExit(event => {ended = true; exitCode = event.exitCode; clearTimeout(hardStop); options.signal?.removeEventListener('abort', abort); data.dispose(); finish(); changed()})
  options.signal?.addEventListener('abort', abort, {once:true})
  if (options.signal?.aborted) {await close(); throw new Error('Background attachment cancelled')}
  return {
    get snapshot(): ClaudeBackgroundAttachmentSnapshot {return {id, jobId:session.id, sessionId:session.sessionId, cwd:session.cwd, clientPid:client.pid, status:ended?'exited':'live', exitCode, output:[...chunks]}},
    subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener)},
    input(ownerId,text) {if (ownerId !== id || ended || closing || typeof text !== 'string' || text.length > 32768) return false; client.write(text); return true},
    resize(ownerId,columns,rows) {if (ownerId !== id || ended || closing || !Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || columns < 2 || columns > 500 || rows < 2 || rows > 200) return false; client.resize(columns,rows); return true},
    close,
  }
}
