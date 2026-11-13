import {randomUUID} from 'node:crypto'
import {lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'

/** One original worker's main helper; native policy and process identity are checked by its owner. */
export function createClaudeBackgroundMainObservation(options: {configPath: string; sessionId: string; pid: number}) {
  let key: string | undefined, generation: string | undefined, command: string | null = null, policyKey: string | undefined
  let latest: bigint | undefined, result: {cost: number; text?: string} | undefined
  return {
    configure(nextCommand: string | null, nextPolicy: string): unknown {
      const nextKey = JSON.stringify([nextCommand, nextPolicy])
      if (nextKey === key) return
      const config = JSON.parse(readFileSync(options.configPath, 'utf8'))
      if (typeof config.generations?.main !== 'string' || typeof config.mainObservationClaimed !== 'boolean') throw Error('Invalid native main-helper startup scope')
      // A fresh process may have finished before registration. Every subsequent owner/epoch gets a
      // new generation; the persistent claim prevents an API reload replaying old startup output.
      const startup = key === undefined && config.mainObservationClaimed === false
      generation = startup ? config.generations.main : randomUUID()
      const temporary = options.configPath + '.' + randomUUID()
      writeFileSync(temporary, JSON.stringify({...config, mainObservationClaimed: true, generations: {...config.generations, main: generation}}), {mode: 0o600, flag: 'wx'})
      renameSync(temporary, options.configPath)
      key = nextKey; command = nextCommand; policyKey = nextPolicy; latest = undefined; result = undefined
      if (!startup) return
      const path = join(dirname(options.configPath), 'startup-main.json')
      try {
        const stat = lstatSync(path)
        if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 262144) throw Error('Unowned native main-helper startup result')
        const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
        unlinkSync(path)
        return value
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    },
    accept(value: Record<string, unknown>) {
      if (!key || !command || value.kind !== 'main' || value.sessionId !== options.sessionId || value.parentPid !== options.pid
        || value.generation !== generation || value.policyKey !== policyKey || value.command !== command
        || typeof value.startedAt !== 'string' || !/^[0-9]{1,30}$/.test(value.startedAt)
        || typeof value.totalCostUsd !== 'number' || !Number.isFinite(value.totalCostUsd) || value.totalCostUsd < 0
        || !(Number.isSafeInteger(value.code) || value.code === null && typeof value.signal === 'string') || typeof value.truncated !== 'boolean' || typeof value.stdout !== 'string' || Buffer.byteLength(value.stdout) > 32768) return false
      const started = BigInt(value.startedAt)
      if (latest !== undefined && started <= latest) return false
      latest = started
      const text = value.code === 0 && !value.truncated && !value.signal ? value.stdout.trim().split('\n').flatMap(line => line.trim() || []).join('\n') || undefined : undefined
      result = {cost: value.totalCostUsd, text}
      return true
    },
    matchesPolicy(nextCommand: unknown, nextPolicy: string) { return key !== undefined && command === nextCommand && policyKey === nextPolicy },
    get startedAt() { return latest },
    matchesCost(cost: number | undefined) { return result !== undefined && result.cost === cost },
    value(cost: number | undefined) { return result?.cost === cost ? result?.text : undefined },
    clear() { key = undefined; generation = undefined; latest = undefined; result = undefined; command = null; policyKey = undefined },
  }
}
