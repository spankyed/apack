import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type Socket } from 'node:net'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { openClaudeTerminalAttachment, type ClaudeBackgroundAttachment } from './background-attachment.ts'

const execute = promisify(execFile)
const decimal = z.string().regex(/^\d{1,24}$/)
const positivePid = z.string().regex(/^[1-9][0-9]{0,9}$/)
const absolute = z.string().max(4096).refine(isAbsolute)
const uuid = z.string().uuid()
const maxPanes = 64
const recoveryPane = z.object({
  ownerId: uuid, sessionId: uuid, taskId: z.string().min(1).max(256), name: z.string().min(1).max(512),
  executable: absolute, cwd: absolute, executableIdentity: z.tuple([decimal, decimal, z.string().regex(/^-?\d{1,24}$/)]),
  socket: absolute, socketIdentity: z.tuple([decimal, decimal]), bootId: uuid,
  tmuxSession: z.string().regex(/^\$\d+$/), paneId: z.string().regex(/^%\d+$/),
  server: z.tuple([positivePid, decimal]), worker: z.tuple([positivePid, decimal]),
  writer: z.tuple([positivePid, decimal]).optional(),
}).strict()
const savedPanes = z.array(recoveryPane).max(maxPanes)
export type ClaudeRecoveryPane = z.infer<typeof recoveryPane>
type PaneTarget = Pick<ClaudeRecoveryPane, 'ownerId' | 'sessionId' | 'taskId' | 'name' | 'executable' | 'cwd' | 'tmuxSession' | 'paneId'>

function fileIdentity(file: { dev: bigint; ino: bigint }) {
  return [String(file.dev), String(file.ino)] as [string, string]
}

async function executableIdentity(executable: string) {
  const file = await stat(executable, { bigint: true })
  if (!file.isFile() || file.uid !== 0n && file.uid !== BigInt(process.getuid!())
    || (file.mode & 0o111n) === 0n || (file.mode & 0o022n) !== 0n) throw Error('Claude teammate tmux executable changed')
  return [...fileIdentity(file), String(file.ctimeNs)] as [string, string, string]
}

async function readProcessStart(pid: string, signal?: AbortSignal) {
  try {
    const source = await readFile(`/proc/${pid}/stat`, { encoding: 'utf8', signal })
    const fields = source.slice(source.lastIndexOf(') ') + 2).split(' ')
    if (fields[0] === 'Z') return
    if (!fields[19] || !/^\d{1,24}$/.test(fields[19])) throw Error('Could not verify the native teammate process')
    return fields[19]
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return
    throw error
  }
}

async function processStart(pid: string, signal: AbortSignal) {
  const start = await readProcessStart(pid, signal)
  if (!start) throw Error('The native teammate process ended')
  return start
}

async function inspectPane(target: PaneTarget, address: string[], env: NodeJS.ProcessEnv, signal: AbortSignal) {
  const probe = (args: string[]) => execute(target.executable, [...address, ...args], { env, signal, cwd: target.cwd, timeout: 2000, maxBuffer: 8192 }).then(result => result.stdout.trim())
  // Keep socket_path last because a legitimate path can contain the separator.
  const lines = await probe(['list-panes', '-s', '-t', target.tmuxSession, '-F', '#{pane_id}|#{pid}|#{pane_pid}|#{pane_dead}|#{window_active}|#{socket_path}'])
  const [pane, duplicate] = lines.split('\n').map(line => /^(%\d+)\|([1-9]\d{0,9})\|([1-9]\d{0,9})\|0\|([01])\|(.*)$/.exec(line))
    .filter(row => row?.[1] === target.paneId)
  if (!pane || duplicate || !isAbsolute(pane[5]!)) throw Error('The original tmux pane is unavailable')
  const [, , serverPid, workerPid, windowActive, socket] = pane
  const [file, serverStart, workerStart] = await Promise.all([
    lstat(socket!, { bigint: true }), processStart(serverPid!, signal), processStart(workerPid!, signal),
  ])
  if (!file.isSocket() || file.uid !== BigInt(process.getuid!())) throw Error('The native teammate socket changed')
  if (await probe(['show-options', '-Av', '-t', target.tmuxSession, 'destroy-unattached']) !== 'off') throw Error('The native teammate terminal cannot be safely attached')
  return { socket: socket!, socketIdentity: fileIdentity(file), server: [serverPid!, serverStart], worker: [workerPid!, workerStart], activeWindow: windowActive === '1', probe }
}

async function bootId() { return (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() }

export async function identifyClaudeRecoveryPane(target: PaneTarget, writerPid: number, address: string[], env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<ClaudeRecoveryPane | undefined> {
  if (process.platform !== 'linux') return
  const writer = String(writerPid)
  const writerStart = await processStart(writer, signal)
  const identity = await executableIdentity(target.executable)
  const { socket, socketIdentity, server, worker } = await inspectPane(target, address, env, signal)
  return recoveryPane.parse({ ...target, socket, socketIdentity, server, worker, executableIdentity: identity, bootId: await bootId(), writer: [writer, writerStart] })
}

export class ClaudeTeammateEnded extends Error {
  constructor() { super('The native teammate process ended') }
}

export function createClaudeTeammateRecovery(pane: ClaudeRecoveryPane, env: NodeJS.ProcessEnv) {
  const address = ['-S', pane.socket]
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index])
  const verify = async (signal: AbortSignal) => {
    // Check the filesystem and process generations before contacting a persisted socket.
    if (process.platform !== 'linux' || await bootId() !== pane.bootId
      || !same(await executableIdentity(pane.executable), pane.executableIdentity)) throw Error('The teammate recovery host changed')
    if (pane.writer && await readProcessStart(pane.writer[0], signal) === pane.writer[1]) throw Error('The original Claude writer is still active')
    if (await readProcessStart(pane.worker[0], signal) !== pane.worker[1]) throw new ClaudeTeammateEnded()
    const file = await lstat(pane.socket, { bigint: true })
    if (!file.isSocket() || file.uid !== BigInt(process.getuid!()) || !same(fileIdentity(file), pane.socketIdentity)
      || await processStart(pane.server[0], signal) !== pane.server[1]) throw Error('The original teammate pane is unavailable')
    const current = await inspectPane(pane, address, env, signal)
    if (!current.activeWindow || current.socket !== pane.socket || !same(current.socketIdentity, pane.socketIdentity)
      || !same(current.server, pane.server) || !same(current.worker, pane.worker)) throw Error('The original teammate pane is unavailable')
    return current
  }
  return {
    async canReconnect(signal: AbortSignal) { return verify(signal).then(() => true, () => false) },
    async reconnect(signal: AbortSignal) {
      const current = await verify(signal)
      const ready = `apack-${randomUUID()}`
      // Only the new client's selection changes. Wait for pane selection before forwarding anything.
      return openRecoveredTeammate(pane, env, signal, verify, current.probe, ready)
    },
  }
}

// The broker interprets the tmux drawing and encodes input on this PTY. Keep tmux itself read-only:
// an active-pane client silently falls back to another worker when its original pane disappears.
const teammateTerminalRelay = `
const connection = require('node:net').createConnection(process.argv[1]);
const finish = () => { process.stdin.destroy(); };
connection.once('connect', () => {
  process.stdin.setRawMode(true);
  process.stdin.pipe(connection);
  connection.pipe(process.stdout);
});
connection.on('error', () => { process.exitCode = 1; connection.destroy(); });
connection.once('close', finish);
`

async function openRecoveredTeammate(
  pane: ClaudeRecoveryPane, env: NodeJS.ProcessEnv, signal: AbortSignal,
  verify: (signal: AbortSignal) => Promise<unknown>,
  probe: (args: string[]) => Promise<string>, ready: string,
): Promise<ClaudeBackgroundAttachment> {
  const directory = await mkdtemp(join('/tmp', 'apack-teammate-'))
  const socketPath = join(directory, 'terminal.sock')
  const listener = createServer()
  const lifetime = new AbortController()
  const childSignal = AbortSignal.any([signal, lifetime.signal])
  const session = { id: pane.taskId, sessionId: pane.sessionId, cwd: pane.cwd }
  let wire: Socket | undefined
  let display: ClaudeBackgroundAttachment | undefined
  let tmux: ClaudeBackgroundAttachment | undefined
  let endedTeammate = false
  let checking = false
  let checkTimer: NodeJS.Timeout | undefined
  let closing: Promise<void> | undefined

  function close() {
    return closing ??= Promise.resolve().then(async () => {
      clearInterval(checkTimer)
      lifetime.abort()
      listener.close()
      wire?.destroy()
      await Promise.allSettled([display?.close(), tmux?.close()])
      await rm(directory, { recursive: true, force: true })
    })
  }
  function ended(error: unknown) {
    if (error instanceof ClaudeTeammateEnded) endedTeammate = true
    void close().catch(() => {})
  }
  async function acceptInput(connection: Socket) {
    childSignal.throwIfAborted()
    for await (const data of connection) {
      childSignal.throwIfAborted()
      if (await readProcessStart(pane.worker[0], childSignal) !== pane.worker[1]) throw new ClaudeTeammateEnded()
      try {
        await pasteExactTeammateInput(pane, env, Buffer.from(data), childSignal)
      } catch {
        // Drop a refused input. Keep reading the relay so the socket itself does not close the view.
        // The monitor checks the original worker and pane independently.
        childSignal.throwIfAborted()
      }
    }
  }

  try {
    listener.listen(socketPath)
    await once(listener, 'listening', {signal: childSignal})
    // This private socket waits for its owned relay process, independent of the tmux server.
    const connected = once(listener, 'connection', { signal: AbortSignal.any([childSignal, AbortSignal.timeout(5000)]) })
    void connected.catch(() => {})
    display = await openClaudeTerminalAttachment(process.execPath, ['--eval', teammateTerminalRelay, socketPath], session,
      { env: {...env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: ''}, signal: childSignal })
    const [connection] = await connected as [Socket]
    wire = connection
    listener.close()
    display.subscribe(() => { if (display?.snapshot.status === 'exited') void close().catch(() => {}) })
    void acceptInput(connection).then(() => close(), ended).catch(() => {})

    tmux = await openClaudeTerminalAttachment(pane.executable, ['-S', pane.socket,
      'attach-session', '-E', '-f', 'ignore-size,active-pane', '-t', pane.tmuxSession,
      ';', 'select-pane', '-Z', '-t', `${pane.tmuxSession}:.${pane.paneId}`, ';', 'refresh-client', '-f', 'read-only', ';', 'wait-for', '-S', ready],
    session, { env, signal: childSignal, output(text) {
      if (closing) return
      if (connection.writableLength + Buffer.byteLength(text) > 1024 * 1024) { void close().catch(() => {}); return }
      connection.write(text)
    } })
    tmux.subscribe(() => {
      if (tmux?.snapshot.status === 'exited' && !closing) void verify(childSignal).then(close, ended).catch(() => {})
    })
    await probe(['wait-for', ready])
    await verify(childSignal)
    if (tmux.snapshot.status !== 'live' || display.snapshot.status !== 'live') throw Error('The teammate terminal disconnected')
    const terminal = display, reader = tmux
    // Input is pinned independently. This timer notices a dead pane when the user is idle.
    checkTimer = setInterval(() => {
      if (checking || closing) return
      checking = true
      void verify(childSignal).catch(ended).finally(() => { checking = false })
    }, 500)
    checkTimer.unref()
    return {
      get snapshot() { return terminal.snapshot },
      get endedTeammate() { return endedTeammate },
      subscribe: terminal.subscribe,
      input: terminal.input,
      resize(id, columns, rows, cell) {
        if (!terminal.resize(id, columns, rows, cell)) return false
        return reader.resize(reader.snapshot.id, columns, rows, cell)
      },
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}

async function pasteExactTeammateInput(pane: ClaudeRecoveryPane, env: NodeJS.ProcessEnv, data: Buffer, signal: AbortSignal) {
  // An explicit pane target never follows the display client's selection. Raw paste writes directly to
  // that pane's PTY, including if the window has synchronize-panes enabled.
  const buffer = 'apack-' + randomUUID()
  const condition = `#{&&:#{==:#{pid},${pane.server[0]}},#{&&:#{==:#{pane_pid},${pane.worker[0]}},#{==:#{pane_dead},0}}}`
  const command = `paste-buffer -d -r -b ${buffer} -t ${pane.paneId}`
  const discard = `delete-buffer -b ${buffer} ; display-message -p refused`
  const address = ['-S', pane.socket]
  const child = spawn(pane.executable, [...address, 'load-buffer', '-b', buffer, '-', ';',
    'if-shell', '-F', '-t', pane.paneId, condition, command, discard],
    { env, cwd: pane.cwd, signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]), stdio: ['pipe', 'pipe', 'ignore'] })
  let refused = false
  child.stdout.resume()
  child.stdout.on('data', () => { refused = true })
  child.stdin.on('error', () => { refused = true })
  try {
    const closed = once(child, 'close')
    child.stdin.end(data)
    const [code] = await closed
    if (code === 0 && !refused) return
  } catch (error) {
    if (!signal.aborted) throw error
  } finally {
    // The buffer normally disappears in the same tmux command queue. A failed target lookup can
    // bypass that command, so make one bounded cleanup attempt using its unique name.
    if (refused || child.exitCode !== 0)
      await execute(pane.executable, [...address, 'delete-buffer', '-b', buffer], {env, cwd:pane.cwd, timeout:2000}).catch(() => {})
  }
  signal.throwIfAborted()
  throw Error('The original teammate pane is unavailable')
}

type RecoveryScope = { profile: string; threadId: string; sessionId: string }
async function checkpoint(scope: RecoveryScope, create: boolean) {
  const root = join(tmpdir(), `apack-claude-teammates-${process.getuid!()}`)
  if (create) await mkdir(root, { mode: 0o700, recursive: true })
  const directory = await lstat(root)
  if (!directory.isDirectory() || directory.uid !== process.getuid!() || (directory.mode & 0o077)) throw Error('Claude teammate checkpoint directory is not private')
  const key = createHash('sha256').update(JSON.stringify([scope.profile, scope.threadId, scope.sessionId])).digest('hex')
  return join(root, `${key}.json`)
}

export async function readClaudeTeammateCheckpoint(scope: RecoveryScope): Promise<ClaudeRecoveryPane[]> {
  if (process.platform !== 'linux') return []
  try {
    const handle = await open(await checkpoint(scope, false), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const file = await handle.stat()
      if (!file.isFile() || file.uid !== process.getuid!() || (file.mode & 0o077) || file.size > 2 * 1024 * 1024) throw Error('Claude teammate checkpoint file is not private')
      return savedPanes.parse(JSON.parse(await handle.readFile('utf8'))).filter(pane => pane.sessionId === scope.sessionId)
    } finally { await handle.close() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

const checkpointUpdates = new Map<string, Promise<void>>()

function updateCheckpoint(scope: RecoveryScope, update: (records: ClaudeRecoveryPane[]) => Promise<ClaudeRecoveryPane[] | undefined>) {
  const key = JSON.stringify([scope.profile, scope.threadId, scope.sessionId])
  const pending = (checkpointUpdates.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const records = await update(await readClaudeTeammateCheckpoint(scope))
    if (!records) return
    const path = await checkpoint(scope, records.length > 0)
    if (!records.length) {
      await rm(path, { force: true })
      return
    }
    const staged = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(staged, JSON.stringify(savedPanes.parse(records)), { flag: 'wx', mode: 0o600 })
      await rename(staged, path)
    } finally { await rm(staged, { force: true }) }
  })
  checkpointUpdates.set(key, pending)
  return pending.finally(() => {
    if (checkpointUpdates.get(key) === pending) checkpointUpdates.delete(key)
  })
}

async function isSameProcess([pid, savedStart]: ClaudeRecoveryPane['worker']) {
  try {
    return await readProcessStart(pid) === savedStart
  } catch {
    // A failed read cannot establish that the process ended.
    return true
  }
}

export async function saveClaudeTeammateCheckpoint(scope: RecoveryScope, panes: ClaudeRecoveryPane[]) {
  const first = panes[0]
  if (process.platform !== 'linux' || !first) return
  await updateCheckpoint(scope, async previous => {
    const current = new Map(panes.map(pane => [pane.taskId, pane]))
    const kept: ClaudeRecoveryPane[] = []
    for (const pane of previous) {
      if (current.has(pane.taskId) || pane.bootId !== first.bootId) continue
      // The writer or active window can change before recovery. Only a retired process invalidates its saved identity here.
      const [serverAlive, workerAlive] = await Promise.all([isSameProcess(pane.server), isSameProcess(pane.worker)])
      if (serverAlive && workerAlive) kept.push(pane)
    }
    return [...kept, ...current.values()].slice(-maxPanes)
  })
}

export async function clearClaudeTeammateCheckpoint(scope: RecoveryScope, ownerId: string) {
  if (process.platform !== 'linux') return
  await updateCheckpoint(scope, async previous => {
    const remaining = previous.filter(pane => pane.ownerId !== ownerId)
    return remaining.length === previous.length ? undefined : remaining
  })
}
