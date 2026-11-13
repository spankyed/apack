import {createHash, randomUUID} from 'node:crypto'
import {mkdir, readFile, rename, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {claudeBackgroundFormatterRuntime} from './background-formatter-runtime.ts'

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
/** One tiny immutable launcher per runtime revision survives broker loss; OS temporary storage owns it. */
export async function installClaudeBackgroundFormatterLauncher() {
  const source = '#!/bin/sh\nset -- "${ELECTRON_RUN_AS_NODE+x}:${ELECTRON_RUN_AS_NODE-}" "$@"\nELECTRON_RUN_AS_NODE=1 exec ' + quote(process.execPath) + ' --input-type=module -e ' + quote(claudeBackgroundFormatterRuntime) + ' -- "$@"\n'
  const digest = createHash('sha256').update(source).digest('hex')
  const directory = join(tmpdir(), 'apack-native-formatter-' + process.getuid?.())
  await mkdir(directory, {recursive: true, mode: 0o700})
  const info = await stat(directory)
  if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new Error('Native formatter launcher directory is not private')
  const path = join(directory, digest)
  try { if (await readFile(path, 'utf8') === source) return path } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const temporary = path + '.' + randomUUID()
  await writeFile(temporary, source, {mode: 0o700, flag: 'wx'})
  await rename(temporary, path)
  return path
}

/** Output belongs to one verified worker/lease and the currently observed native helper policy. */
export function createClaudeBackgroundFormatter(options: {launcher: string; socketPath: string; brokerToken: string; changed(): void}) {
  let current: {key: string; generation: string; sessionId: string; pid: number; token: string; prefix: string | null; originalPrefix: string | null; startedAt?: bigint; totalCostUsd?: number; stdout?: string} | undefined
  return {
    configure(value: Record<string, unknown>): {shellPrefix: string | null; originalPrefix: string | null} | undefined {
      const formatter = value.formatter as {command?: unknown; shellPrefix?: unknown; policy?: unknown} | undefined
      if (!formatter) { this.reset(); return }
      for (const field of ['command', 'shellPrefix'] as const) if (formatter[field] !== null && (typeof formatter[field] !== 'string' || formatter[field].length > 32768)) throw new Error('Invalid background formatter configuration')
      if (typeof formatter.policy !== 'string' || formatter.policy.length > 32768 || typeof value.sessionId !== 'string' || !Number.isSafeInteger(value.pid) || typeof value.token !== 'string') throw new Error('Invalid background formatter lease')
      const command = formatter.command as string | null
      let originalPrefix = formatter.shellPrefix as string | null
      const split = originalPrefix?.lastIndexOf(' -') ?? -1
      const previousLauncher = split > 0 ? originalPrefix!.slice(0, split) : undefined
      const ownedLauncher = previousLauncher === options.launcher || previousLauncher?.startsWith(dirname(options.launcher) + '/')
        && /^[a-f0-9]{64}$/.test(previousLauncher.slice(dirname(options.launcher).length + 1))
      if (originalPrefix && ownedLauncher) {
        try {
          // A surviving worker can still carry the previous immutable launcher after an API update.
          const previous = JSON.parse(Buffer.from(originalPrefix.slice(split + 2), 'base64url').toString())
          if (previous.brokerToken === options.brokerToken && previous.socketPath === options.socketPath && previous.sessionId === value.sessionId && previous.pid === value.pid
            && (previous.originalPrefix === null || typeof previous.originalPrefix === 'string')) originalPrefix = previous.originalPrefix
        } catch { /* An unrelated prefix remains the user's original command. */ }
      }
      const key = JSON.stringify([value.sessionId, value.pid, value.token, command, originalPrefix, formatter.policy])
      if (current?.key !== key) {
        const generation = randomUUID()
        const config = {sessionId: value.sessionId, pid: value.pid, token: value.token, generation, command, originalPrefix, socketPath: options.socketPath, brokerToken: options.brokerToken}
        const prefix = command ? options.launcher + ' -' + Buffer.from(JSON.stringify(config)).toString('base64url') : originalPrefix
        current = {key, generation, sessionId: value.sessionId, pid: value.pid as number, token: value.token, prefix, originalPrefix}
        options.changed()
      }
      return {shellPrefix: current.prefix, originalPrefix: current.originalPrefix}
    },
    matches(value: Record<string, unknown>) { return !!current && value.sessionId === current.sessionId && value.pid === current.pid && value.token === current.token && value.generation === current.generation },
    accept(value: Record<string, unknown>) {
      if (!this.matches(value) || typeof value.startedAt !== 'string' || !/^[0-9]{1,30}$/.test(value.startedAt) || current!.startedAt !== undefined && BigInt(value.startedAt) <= current!.startedAt || typeof value.totalCostUsd !== 'number' || !Number.isFinite(value.totalCostUsd) || value.totalCostUsd < 0 || typeof value.stdout !== 'string' || Buffer.byteLength(value.stdout) > 32768) throw new Error('Background formatter generation expired')
      current!.startedAt = BigInt(value.startedAt as string); current!.totalCostUsd = value.totalCostUsd as number; current!.stdout = value.stdout.trim().split('\n').flatMap(line => line.trim() || []).join('\n') || undefined; options.changed()
    },
    // The native helper and plugin usage poll run independently. Do not pair one observation's
    // text with another observation's total, even while the worker/policy generation is unchanged.
    matchesCost(totalCostUsd: number | undefined) { return !!current && typeof totalCostUsd === 'number' && current.totalCostUsd === totalCostUsd },
    get value() { return current?.stdout },
    reset() { if (current) { current = undefined; options.changed() } },
  }
}
