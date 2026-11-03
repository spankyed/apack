import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { query, EARS } from '#generated/ears.ts'
import { codeIndexCommands, codeIndexQueries, projectIdOf, symbolIdOf } from '#features/code/be/code-index/repository.ts'
import { createSyncRunner, removeProject, syncProject, MAX_FILE_BYTES } from '#features/code/be/code-index/sync.ts'
import { semanticDiff } from '#features/code/be/code-index/semantic-diff.ts'

let root: string
const never = new AbortController().signal

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
const put = (file: string, text: string | Buffer) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), text)
}
const commit = (message = 'c') => { git('add', '-A'); git('commit', '-qm', message, '--allow-empty') }

const symbols = () => query(EARS.Entity.CodeSymbol).where('project', projectIdOf(root)).pickAll()
/** Everything the index holds of the project, without the times, ordered: what two indexes are compared by */
const held = () => ({
  files: query(EARS.Entity.CodeFile).where('project', projectIdOf(root)).pickAll()
    .map(({ id, path: file, oid, language, test, skipped }) => ({ id, file, oid, language, test, skipped })).sort((a, b) => a.file.localeCompare(b.file)),
  symbols: symbols()
    .map(({ id, file, kind, name, qualifiedName, exported, signature, signatureHash, bodyHash }) => ({ id, file, kind, name, qualifiedName, exported, signature, signatureHash, bodyHash }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id))),
})
const enable = () => codeIndexCommands.setEnabled(root, true)
const sync = () => syncProject(root, never)
const clearProject = async () => {
  codeIndexCommands.setEnabled(root, false)
  await removeProject(root, never)
}

beforeEach(async () => {
  await startApp({ systems: [] })
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-index-')))
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'a@b.c')
  git('config', 'user.name', 'a')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('what a sync writes', () => {
  it('indexes tracked, modified and untracked files, and nothing ignored', async () => {
    put('.gitignore', 'ignored.ts\n')
    put('tracked.ts', 'export function tracked() {}')
    put('changed.ts', 'export function before() {}')
    commit()
    put('changed.ts', 'export function after() {}')
    put('untracked.ts', 'export function untracked() {}')
    put('ignored.ts', 'export function ignored() {}')
    put('notes.md', 'not code')
    enable()
    await sync()
    expect(symbols().map(s => s.name).sort()).toEqual(['after', 'tracked', 'untracked'])
    expect(codeIndexQueries.status(root)).toMatchObject({ enabled: true, progress: { state: 'idle', files: 3, symbols: 3, pending: 0 } })
  })

  it('leaves out a symlink and a deleted file', async () => {
    put('real.ts', 'export function real() {}')
    put('deleted.ts', 'export function deleted() {}')
    fs.symlinkSync('real.ts', path.join(root, 'link.ts'))
    commit()
    fs.rmSync(path.join(root, 'deleted.ts'))
    enable()
    await sync()
    expect(symbols().map(s => s.qualifiedName)).toEqual(['real.ts#real'])
  })

  it('drops a file deleted from disk but not yet from git', async () => {
    put('a.ts', 'export function a() {}')
    put('b.ts', 'export function b() {}')
    commit()
    enable()
    await sync()
    fs.rmSync(path.join(root, 'b.ts'))
    await sync()
    expect(symbols().map(s => s.name)).toEqual(['a'])
    expect(codeIndexQueries.status(root).progress).toMatchObject({ files: 1, symbols: 1 })
  })

  it('keeps ids across a save, and writes no row for a reformat', async () => {
    put('a.ts', 'export function keep() { return 1 }\nexport function move() { return 1 }')
    commit()
    enable()
    await sync()
    const before = new Map(symbols().map(s => [s.name, s]))
    expect(before.get('keep')!.id).toBe(symbolIdOf(projectIdOf(root), 'a.ts', { local: 'keep', ordinal: 0 }))

    put('a.ts', '\n\n// moved down\nexport function keep() {\n  return 1;\n}\nexport function move() { return 2 }')
    await sync()
    const after = new Map(symbols().map(s => [s.name, s]))
    expect(after.get('keep')).toEqual(before.get('keep'))
    expect(after.get('move')!.id).toBe(before.get('move')!.id)
    expect(after.get('move')!.bodyHash).not.toBe(before.get('move')!.bodyHash)
  })

  it('gives two definitions of a name their own ids, the same each time', async () => {
    put('a.ts', 'function f(a: string): void; function f(a: unknown) {}')
    commit()
    enable()
    await sync()
    const ids = symbols().map(s => s.id).sort()
    expect(new Set(ids).size).toBe(2)
    await clearProject()
    enable()
    await sync()
    expect(symbols().map(s => s.id).sort()).toEqual(ids)
  })

  it('parses only files whose blob moved', async () => {
    put('a.ts', 'export function a() {}')
    put('b.ts', 'export function b() {}')
    commit()
    enable()
    await sync()
    const read = vi.spyOn(fs.promises, 'readFile')
    put('b.ts', 'export function b2() {}')
    await sync()
    expect(read.mock.calls.map(([file]) => path.basename(String(file)))).toEqual(['b.ts'])
    read.mockRestore()
  })

  it('re-extracts every file when the extractor answers differently', async () => {
    put('a.ts', 'export function a() {}')
    commit()
    enable()
    await sync()
    const stored = codeIndexQueries.project(root)!.extractorStamp!
    expect(stored).toBeTruthy()
    codeIndexCommands.setStamp(root, 'another')
    const read = vi.spyOn(fs.promises, 'readFile')
    await sync()
    expect(read.mock.calls.map(([file]) => path.basename(String(file)))).toEqual(['a.ts'])
    read.mockRestore()
    expect(codeIndexQueries.project(root)!.extractorStamp).toBe(stored)
  })

  it('counts what it leaves out, by reason', async () => {
    put('large.ts', 'x'.repeat(MAX_FILE_BYTES + 1))
    put('latin.ts', Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    put('good.ts', 'export function good() {}')
    commit()
    enable()
    await sync()
    expect(codeIndexQueries.status(root).progress).toMatchObject({ files: 3, symbols: 1, skipped: { 'too-large': 1, 'not-utf8': 1 } })
  })

  it('says a directory that is not a git repository is one', async () => {
    fs.rmSync(path.join(root, '.git'), { recursive: true })
    enable()
    await sync()
    expect(codeIndexQueries.status(root).progress).toMatchObject({ state: 'not-git', files: 0 })
  })
})

describe('turning a project off', () => {
  it('removes its rows and nothing else', async () => {
    put('a.ts', 'export function a() {}')
    commit()
    enable()
    await sync()
    const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-index-other-')))
    try {
      execFileSync('git', ['init', '-q'], { cwd: other })
      fs.writeFileSync(path.join(other, 'b.ts'), 'export function b() {}')
      codeIndexCommands.setEnabled(other, true)
      await syncProject(other, never)

      await clearProject()
      expect(codeIndexQueries.project(root)).toBeUndefined()
      expect(symbols()).toEqual([])
      expect(query(EARS.Entity.CodeFile).where('project', projectIdOf(root)).count()).toBe(0)
      expect(codeIndexQueries.status(root)).toEqual({ enabled: false, progress: null })
      expect(query(EARS.Entity.CodeSymbol).where('project', projectIdOf(other)).count()).toBe(1)
    } finally { fs.rmSync(other, { recursive: true, force: true }) }
  })

  it('a project never turned on is not read', async () => {
    put('a.ts', 'export function a() {}')
    commit()
    const runner = createSyncRunner((error) => { throw error })
    await runner.request(root)
    expect(codeIndexQueries.project(root)).toBeUndefined()
    expect(query(EARS.Entity.CodeFile).count()).toBe(0)
  })
})

describe('the running sync', () => {
  const someFiles = (n: number) => { for (let i = 0; i < n; i++) put(`f${i}.ts`, `export function f${i}() { return ${i} }`) }

  it('a sync cut short finishes on the next run, equal to a fresh index', async () => {
    someFiles(40)
    commit()
    enable()
    const controller = new AbortController()
    let reads = 0
    const realRead = fs.promises.readFile
    vi.spyOn(fs.promises, 'readFile').mockImplementation(((...args: Parameters<typeof realRead>) => {
      if (++reads === 20) controller.abort()
      return realRead(...args)
    }) as typeof realRead)
    await expect(syncProject(root, controller.signal)).rejects.toThrow()
    vi.restoreAllMocks()
    const partial = query(EARS.Entity.CodeFile).where('project', projectIdOf(root)).count()
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(40)

    await sync()
    const finished = held()
    await clearProject()
    enable()
    await sync()
    expect(held()).toEqual(finished)
  })

  it('a new request cancels the running one and ends in sync', async () => {
    someFiles(30)
    commit()
    enable()
    const errors: unknown[] = []
    const runner = createSyncRunner(error => errors.push(error))
    const first = runner.request(root)
    put('fresh.ts', 'export function fresh() {}')
    const second = runner.request(root)
    await Promise.all([first, second])
    expect(errors).toEqual([])
    expect(symbols().map(s => s.name)).toContain('fresh')
    expect(codeIndexQueries.status(root).progress).toMatchObject({ state: 'idle', pending: 0, symbols: 31 })
    await runner.stop()
  })

  it('records a failed sync on the project', async () => {
    put('a.ts', 'export function a() {}')
    commit()
    enable()
    const errors: unknown[] = []
    const runner = createSyncRunner(error => errors.push(error))
    fs.writeFileSync(path.join(root, '.git', 'index'), 'not an index')
    await runner.request(root)
    expect(errors).toHaveLength(1)
    expect(codeIndexQueries.status(root).progress).toMatchObject({ state: 'error' })
  })
})

// A seeded generator, so a failure names the seed that reproduces it
function randomizer(seed: number) {
  let s = seed
  const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
  return { int: (n: number) => Math.floor(next() * n), pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]! }
}

describe('incremental equals full', () => {
  const FILES = ['a.ts', 'dir/b.ts', 'dir/c.tsx', 'd.vue', 'e.cjs', 'dir/f.spec.ts']
  const bodyOf = (random: ReturnType<typeof randomizer>, file: string) => {
    const n = random.int(4)
    const fns = Array.from({ length: n }, (_, i) => `export function fn${random.int(3)}${i}(a${random.int(2)}: string) { return ${random.int(3)} }`).join('\n')
    return file.endsWith('.vue') ? `<template><a${random.int(2)} /></template>\n<script lang="ts">\n${fns}\n</script>` : fns
  }

  it.each([1, 2, 3, 4, 5, 6])('over a random history, seed %i', async (seed) => {
    const random = randomizer(seed)
    enable()
    put('base.ts', 'export function base() {}')
    commit()
    git('branch', 'other')
    await sync()
    for (let step = 0; step < 25; step++) {
      const action = random.int(6)
      const file = random.pick(FILES)
      const absolute = path.join(root, file)
      if (action <= 1) put(file, bodyOf(random, file))
      else if (action === 2) { if (fs.existsSync(absolute)) fs.rmSync(absolute) }
      else if (action === 3) {
        const target = random.pick(FILES)
        if (fs.existsSync(absolute) && !fs.existsSync(path.join(root, target))) { fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true }); fs.renameSync(absolute, path.join(root, target)) }
      } else if (action === 4) commit(`step ${step}`)
      else {
        commit(`switch ${step}`)
        git('checkout', '-q', random.pick(['main', 'other']))
      }
      if (random.int(2) === 0) await sync()
    }
    await sync()
    const incremental = held()
    await clearProject()
    enable()
    await sync()
    expect(incremental).toEqual(held())
  })
})

describe('a semantic diff', () => {
  it('reads a staged change with the index off', async () => {
    put('a.ts', 'export function f() { return 1 }\nexport function gone() {}')
    put('style.ts', 'export function g(){return 1}')
    commit()
    put('a.ts', 'export function f() { return 2 }\nexport function fresh() {}')
    put('style.ts', 'export function g() {\n  return 1;\n}\n')
    put('new.ts', 'export function brandNew() {}')
    put('notes.md', 'prose')
    git('add', '-A')
    const diff = await semanticDiff(root, { staged: true })
    expect(diff.changes.map(c => `${c.path} ${c.change} ${c.name}`).sort()).toEqual([
      'a.ts added fresh', 'a.ts body f', 'a.ts removed gone', 'new.ts added brandNew',
    ])
    expect(diff.unread).toEqual(['notes.md'])
    expect(codeIndexQueries.project(root)).toBeUndefined()
  })

  it('reads a range', async () => {
    put('a.ts', 'export function f(a: string) {}')
    commit()
    const base = git('rev-parse', 'HEAD').trim()
    put('a.ts', 'export function f(b: string) {}')
    fs.rmSync(path.join(root, 'a.ts'))
    put('b.ts', 'export function h() {}')
    commit()
    const diff = await semanticDiff(root, { base, head: 'HEAD' })
    expect(diff.changes.map(c => `${c.path} ${c.change} ${c.name}`).sort()).toEqual(['a.ts removed f', 'b.ts added h'])
  })
})

describe('searching symbols', () => {
  it('finds by name, in this project, with tests after the rest', async () => {
    put('tests/a.spec.ts', 'export function widgetHelper() {}')
    put('src/a.ts', 'export function widgetMaker(size: number) {}\nexport function other(widgetArg: string) {}')
    commit()
    enable()
    await sync()
    const results = codeIndexQueries.searchSymbols(root, 'widgetM', 10)
    expect(results.map(r => r.name)).toEqual(['widgetMaker'])
    expect(results[0]).toMatchObject({ path: 'src/a.ts', kind: 'function', test: false })
    const both = codeIndexQueries.searchSymbols(root, 'widgetHelper widgetMaker', 10)
    expect(codeIndexQueries.searchSymbols('/elsewhere', 'widgetMaker', 10)).toEqual([])
    expect(both.every((r, i) => !r.test || both.slice(i).every(rest => rest.test))).toBe(true)
    expect(codeIndexQueries.searchSymbols(root, '  ', 10)).toEqual([])
  })
})
