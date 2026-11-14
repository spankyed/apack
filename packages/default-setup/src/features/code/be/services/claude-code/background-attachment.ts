import { CLAUDE_NATIVE_TERMINAL_COLORS } from '../../terminal-colors.ts'
import {access, stat} from 'node:fs/promises'
import {constants} from 'node:fs'
import {randomUUID} from 'node:crypto'
import type {TerminalSignal} from '@apackdev/sdk/services'
import {services} from '#generated/services.ts'
import {resolveForService} from '../../utils/resolve-cli.ts'
import {buildChildEnv, DENIED_TO_A_CHILD} from './runner.ts'
import {backgroundSession} from './background-sessions.ts'
import type {SubcommandOptions} from './subcommand.ts'
import type {ClaudeNativeContinuation} from './terminal-session.ts'
import type {ClaudeBackgroundAttachmentSnapshot} from '../../../common/native-background.ts'

export interface ClaudeBackgroundAttachment {
  readonly snapshot: ClaudeBackgroundAttachmentSnapshot
  subscribe(listener: () => void): () => void
  input(id: string, text: string): boolean
  resize(id: string, columns: number, rows: number, cell?: {width:number;height:number}): boolean
  close(): Promise<void>
}

/** Own the original attach client; never send Stop to its background worker on close. */
export async function openBackgroundAttachment(continuation: ClaudeNativeContinuation, jobId: string, options: SubcommandOptions = {}): Promise<ClaudeBackgroundAttachment> {
  // Detaching without ending the worker is a signal to the client's process group (`signal` below), and the
  // terminal service refuses a signal off POSIX rather than approximating one. What would lift this is a
  // broker-side detach, not a platform check here.
  if (process.platform === 'win32') throw new Error('Native background attachment detaches with a POSIX signal, which Windows has no form of')
  if (options.signal?.aborted) throw new Error('Background attachment cancelled')
  const session = await backgroundSession(continuation, {operation: 'refresh'}, options)
  if (!session || session.id !== jobId || session.sessionId !== continuation.continuedInSessionId) throw new Error('Background session changed; refresh before opening it')
  const executable = options.cliPath ?? await resolveForService('claude-code')
  await access(executable, constants.X_OK)
  if (!(await stat(session.cwd)).isDirectory()) throw new Error('Background session directory is unavailable')
  if (options.signal?.aborted) throw new Error('Background attachment cancelled')
  const env: Record<string,string> = {}
  for (const [key,value] of Object.entries(buildChildEnv(options.env))) if (typeof value === 'string') env[key] = value
  const id = randomUUID(), listeners = new Set<() => void>(), chunks: {sequence:number;text:string}[] = []
  let ended = false, closing = false, sequence = 0, bytes = 0, exitCode: number | undefined, hardStop: ReturnType<typeof setTimeout> | undefined
  let finish!: () => void
  const done = new Promise<void>(resolve => {finish = resolve})
  const changed = () => {for (const listener of listeners) {try {listener()} catch { /* isolate windows */ }}}
  // Declared before the open because the exit listener drops it, and defined in terms of `close`, which
  // needs the session the open answers — a function declaration rather than a const, so both can be true
  function abort() {void close().catch(() => {})}
  // **The listeners arrive with the open**, which the contract requires: there is no window in which this
  // client's output has nowhere to go. The pty is the broker's, so `TERM` is its to set and not named here
  const client = await services.terminal.open(
    // `unset` rather than an omission from `env`: a session inherits the host's environment, so leaving a
    // key out of the overrides leaves it inherited
    {images:true,imageFiles:true,colors:CLAUDE_NATIVE_TERMINAL_COLORS,cols: 100, rows: 30, shell: executable, args: ['attach', session.id], env, unset: DENIED_TO_A_CHILD, cwd: session.cwd},
    {
      onOutput: text => {
        if (ended) return
        const raw = Buffer.from(text), tail = raw.subarray(Math.max(0, raw.length - 262144))
        let start = 0; while (start < tail.length && (tail[start]! & 0xc0) === 0x80) start++
        const value = tail.subarray(start).toString('utf8')
        chunks.push({sequence: ++sequence, text: value}); bytes += Buffer.byteLength(value)
        while (chunks.length > 1 && (bytes > 1048576 || chunks.length > 512)) bytes -= Buffer.byteLength(chunks.shift()!.text)
        changed()
      },
      onExit: code => {
        ended = true; exitCode = code ?? undefined; clearTimeout(hardStop)
        options.signal?.removeEventListener('abort', abort); finish(); changed()
      },
    },
  )
  // **This client's own group, and never the worker it attached to.** `terminate` would end the session and
  // everything under it; what has to go is the `attach` process, which the broker refuses to confuse with
  // anything outside this session's tree
  /**
   * A request this client cannot deliver is not the caller's to hear about: every one is a promise, and an
   * unhandled rejection ends the process. What reports a client nobody can reach is its own exit.
   */
  const bestEffort = (sent: Promise<unknown>): void => { void sent.catch(() => {}) }
  const signal = (name: TerminalSignal) => {bestEffort(client.signal(name, {kind: 'group'}))}
  const close = async () => {
    if (!ended && !closing) {
      closing = true
      signal('SIGTERM')
      if (!ended) hardStop = setTimeout(() => {if (!ended) signal('SIGKILL')}, 2000)
      hardStop?.unref()
    }
    return done
  }
  options.signal?.addEventListener('abort', abort, {once:true})
  if (options.signal?.aborted) {await close(); throw new Error('Background attachment cancelled')}
  return {
    get snapshot(): ClaudeBackgroundAttachmentSnapshot {return {id, terminalSession:{id:client.id,target:client.target},inputBlocked:ended||closing, jobId:session.id, sessionId:session.sessionId, cwd:session.cwd, clientPid:client.pid, status:ended?'exited':'live', exitCode, output:[...chunks]}},
    subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener)},
    input(ownerId,text) {if (ownerId !== id || ended || closing || typeof text !== 'string' || text.length > 32768) return false; bestEffort(client.write(text)); return true},
    resize(ownerId,columns,rows,cell) {if (ownerId !== id || ended || closing || !Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || columns < 2 || columns > 500 || rows < 2 || rows > 200) return false; if(cell&&(!Number.isFinite(cell.width)||!Number.isFinite(cell.height)||cell.width<=0||cell.height<=0||cell.width>65535||cell.height>65535))return false;bestEffort(client.resize(columns,rows,cell)); return true},
    close,
  }
}
