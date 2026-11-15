import {randomUUID} from 'node:crypto'
import {lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'

interface ClaudeBackgroundMainResult extends Record<string,unknown> {startedAt:string; totalCostUsd:number; code:number|null; truncated:boolean; stdout:string}
interface ClaudeBackgroundMainReceipt {key: string; cost: number; text: string; startedAt: bigint}

/** One original worker's main helper; native policy and process identity are checked by its owner. */
export function createClaudeBackgroundMainObservation(options: {configPath: string; sessionId: string; pid: number; recovery?: ClaudeBackgroundMainReceipt; recoverObservedMain?:boolean}) {
  let key: string | undefined, generation: string | undefined, command: string | null = null, policyKey: string | undefined
  let recoverObservedMain=options.recoverObservedMain===true
  let startupResult: unknown
  let latest: bigint | undefined, result: {cost: number; text?: string} | undefined
  let cached: ClaudeBackgroundMainReceipt | undefined = options.recovery ? {...options.recovery} : undefined
  const withdraw = () => { recoverObservedMain=false; key = undefined; generation = undefined; latest = undefined; result = undefined; command = null; policyKey = undefined; startupResult = undefined }
  function validObservation(value:Record<string,unknown>,expected:string|undefined):value is ClaudeBackgroundMainResult {
    return typeof expected==='string'&&key!==undefined&&command!==null&&value.kind==='main'&&value.sessionId===options.sessionId&&value.parentPid===options.pid
      &&value.generation===expected&&value.policyKey===policyKey&&value.command===command
      &&typeof value.startedAt==='string'&&/^[0-9]{1,30}$/.test(value.startedAt)
      &&typeof value.totalCostUsd==='number'&&Number.isFinite(value.totalCostUsd)&&value.totalCostUsd>=0
      &&(Number.isSafeInteger(value.code)||value.code===null&&typeof value.signal==='string')&&typeof value.truncated==='boolean'&&typeof value.stdout==='string'&&Buffer.byteLength(value.stdout)<=32768
  }
  const textOf=(value:ClaudeBackgroundMainResult)=>value.code===0&&!value.truncated&&!value.signal?value.stdout.trim().split('\n').flatMap(line=>line.trim()||[]).join('\n')||undefined:undefined
  const canRetainWorkerObservation = (cost: number | undefined) => recoverObservedMain && key !== undefined && command !== null && typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 && result?.cost !== cost && cached?.cost !== cost
  return {
    // A receipt is private evidence, never live output until fresh native validation succeeds.
    get recovery() { return cached ? {...cached} : undefined },
    configure(nextCommand: string | null, nextPolicy: string): unknown {
      const nextKey = JSON.stringify([nextCommand, nextPolicy])
      if (nextKey === key) return startupResult
      const config = JSON.parse(readFileSync(options.configPath, 'utf8'))
      if (typeof config.generations?.main !== 'string' || typeof config.mainObservationClaimed !== 'boolean') throw Error('Invalid native main-helper startup scope')
      // A fresh process may have finished before registration. Every subsequent owner/epoch gets a
      // new generation; the persistent claim prevents an API reload replaying old startup output.
      const startup = key === undefined && config.mainObservationClaimed === false
      generation = startup ? config.generations.main : randomUUID()
      const temporary = options.configPath + '.' + randomUUID()
      writeFileSync(temporary, JSON.stringify({...config, mainObservationClaimed: true, generations: {...config.generations, main: generation}}), {mode: 0o600, flag: 'wx'})
      renameSync(temporary, options.configPath)
      if(key!==undefined)recoverObservedMain=false
      key = nextKey; command = nextCommand; policyKey = nextPolicy; latest = undefined; result = undefined; startupResult = undefined
      if (!startup) return
      const path = join(dirname(options.configPath), 'startup-main.json')
      try {
        const stat = lstatSync(path)
        if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 262144) throw Error('Unowned native main-helper startup result')
        const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
        unlinkSync(path)
        startupResult = value
        return startupResult
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    },
    accept(value: Record<string, unknown>) {
      const scope=key
      if(!scope||!validObservation(value,generation))return false
      const started = BigInt(value.startedAt)
      if (latest !== undefined && started <= latest) return false
      latest = started; startupResult = undefined
      const text = textOf(value)
      result = {cost: value.totalCostUsd, text}
      cached = text ? {key:scope, cost: value.totalCostUsd, text, startedAt: started} : undefined
      return true
    },
    canRetainWorkerObservation,
    discardWorkerObservation(){recoverObservedMain=false},
    retainWorkerObservation(value:unknown,cost:number|undefined){
      if(!canRetainWorkerObservation(cost))return false
      if(!value||typeof value!=='object'||Array.isArray(value)){recoverObservedMain=false;return false}
      const record=value as Record<string,unknown>
      if(typeof record.generation!=='string'||!/^[-A-Za-z0-9]{1,128}$/.test(record.generation)||!validObservation(record,record.generation)){recoverObservedMain=false;return false}
      // Native usage can advance before its debounced helper starts, or lag a completed helper.
      // Keep waiting for an original execution at the reported cost; never reinterpret old input.
      if(record.totalCostUsd!==cost)return false
      const started=BigInt(record.startedAt)
      if(latest!==undefined&&started<=latest||cached!==undefined&&started<=cached.startedAt){recoverObservedMain=false;return false}
      recoverObservedMain=false;startupResult=undefined;result=undefined;latest=started
      const text=textOf(record)
      // This is private evidence from the same worker, not an old-generation live frame.
      // Even a failed execution retires the older receipt. Text still needs native cache proof.
      cached=text?{key:key!,cost:record.totalCostUsd,text,startedAt:started}:undefined
      return text!==undefined
    },
    canRestore(cost: number | undefined) { return result === undefined && !!command && cached !== undefined && cached.key === key && cached.cost === cost },
    restoreCached(value: unknown, cost: number | undefined) {
      if (result !== undefined || !command || !cached || cached.key !== key || cached.cost !== cost || typeof value !== 'string' || Buffer.byteLength(value) > 32768) return false
      const text = value.trim().split('\n').flatMap(line => line.trim() || []).join('\n')
      if (text !== cached.text) return false
      result = {cost: cached.cost, text}; latest = cached.startedAt
      return true
    },
    discardStartup() { startupResult = undefined },
    matchesPolicy(nextCommand: unknown, nextPolicy: string) { return key !== undefined && command === nextCommand && policyKey === nextPolicy },
    get startedAt() { return latest },
    matchesCost(cost: number | undefined) { return result !== undefined && result.cost === cost },
    value(cost: number | undefined) { return result?.cost === cost ? result?.text : undefined },
    // A policy handoff hides output; only fresh native cache validation may reuse the private receipt.
    withdraw,
    clear() { withdraw(); cached = undefined; recoverObservedMain=false },
  }
}
