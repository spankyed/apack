import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { openClaudeTerminalAttachment } from './background-attachment.ts'

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

async function processStart(pid: string, signal: AbortSignal) {
  const source = await readFile(`/proc/${pid}/stat`, { encoding: 'utf8', signal })
  const fields = source.slice(source.lastIndexOf(') ') + 2).split(' ')
  if (fields[0] === 'Z' || !fields[19] || !/^\d{1,24}$/.test(fields[19])) throw Error('The native teammate process ended')
  return fields[19]
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

export async function identifyClaudeRecoveryPane(target: PaneTarget, address: string[], env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<ClaudeRecoveryPane | undefined> {
  if (process.platform !== 'linux') return
  const identity = await executableIdentity(target.executable)
  const { socket, socketIdentity, server, worker } = await inspectPane(target, address, env, signal)
  return recoveryPane.parse({ ...target, socket, socketIdentity, server, worker, executableIdentity: identity, bootId: await bootId() })
}

export function createClaudeTeammateRecovery(pane: ClaudeRecoveryPane, env: NodeJS.ProcessEnv) {
  const address = ['-S', pane.socket]
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index])
  const verify = async (signal: AbortSignal) => {
    // Check the filesystem and process generations before contacting a persisted socket.
    if (process.platform !== 'linux' || await bootId() !== pane.bootId
      || !same(await executableIdentity(pane.executable), pane.executableIdentity)) throw Error('The teammate recovery host changed')
    const file = await lstat(pane.socket, { bigint: true })
    if (!file.isSocket() || file.uid !== BigInt(process.getuid!()) || !same(fileIdentity(file), pane.socketIdentity)
      || await processStart(pane.server[0], signal) !== pane.server[1] || await processStart(pane.worker[0], signal) !== pane.worker[1]) throw Error('The original teammate pane is unavailable')
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
      const client = await openClaudeTerminalAttachment(pane.executable, [...address, 'attach-session', '-E', '-f', 'ignore-size,active-pane', '-t', pane.tmuxSession,
        ';', 'select-pane', '-Z', '-t', `${pane.tmuxSession}:.${pane.paneId}`, ';', 'wait-for', '-S', ready],
        { id: pane.taskId, sessionId: pane.sessionId, cwd: pane.cwd }, { env, signal })
      try {
        await current.probe(['wait-for', ready])
        await verify(signal)
        signal.throwIfAborted()
        if (client.snapshot.status !== 'live') throw Error('The teammate terminal disconnected')
        return client
      } catch (error) {
        await client.close()
        throw error
      }
    },
  }
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

export async function saveClaudeTeammateCheckpoint(scope: RecoveryScope, panes: ClaudeRecoveryPane[], env: NodeJS.ProcessEnv) {
  if (process.platform !== 'linux' || !panes.length) return
  const previous = await readClaudeTeammateCheckpoint(scope)
  const signal = AbortSignal.timeout(10_000)
  const kept: ClaudeRecoveryPane[] = []
  for (const pane of previous) {
    if (signal.aborted) break
    if (await createClaudeTeammateRecovery(pane, env).canReconnect(signal)) kept.push(pane)
  }
  const current = new Map([...kept, ...panes].map(pane => [pane.taskId, pane]))
  const records = savedPanes.parse([...current.values()].slice(-maxPanes))
  const path = await checkpoint(scope, true), staged = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(staged, JSON.stringify(records), { flag: 'wx', mode: 0o600 })
    await rename(staged, path)
  } finally { await rm(staged, { force: true }) }
}
