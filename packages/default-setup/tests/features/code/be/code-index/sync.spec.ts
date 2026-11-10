import { execFileWhileWorking } from '@apackdev/sdk/progress'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { findRelations } from '@apackdev/sdk/ears'
import { query, EARS } from '#generated/ears.ts'
import { codeIndexAnswers, codeIndexCommands, codeIndexQueries, fileIdOf, projectIdOf, symbolIdOf } from '#features/code/be/code-index/repository.ts'
import { createSyncRunner, removeProject, syncProject, MAX_FILE_BYTES } from '#features/code/be/code-index/sync.ts'
import { semanticDiff } from '#features/code/be/code-index/semantic-diff.ts'

let root: string
const never = new AbortController().signal

const git = async (...args: string[]) => (await execFileWhileWorking('git', args, { cwd: root })).stdout
const put = (file: string, text: string | Buffer) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), text)
}
const commit = async (message = 'c') => { await git('add', '-A'); await git('commit', '-qm', message, '--allow-empty') }

const symbols = () => query(EARS.Entity.CodeSymbol).where('project', projectIdOf(root)).pickAll()
/** Everything the index holds of the project, without the times, ordered: what two indexes are compared by */
const edgeKinds = new Set(['code_calls', 'code_references', 'code_inherits', 'code_imports'])
const edges = () => findRelations({}).filter(edge => edgeKinds.has(edge.kind))
  .map(({ kind, source, target, info, weight }) => ({ kind, source, target, info, weight: weight === undefined ? undefined : Math.round(weight * 1000) }))
  .sort((a, b) => `${a.kind}${a.source}${a.target}`.localeCompare(`${b.kind}${b.source}${b.target}`))
const held = () => ({
  edges: edges(),
  files: query(EARS.Entity.CodeFile).where('project', projectIdOf(root)).pickAll()
    .map(({ id, path: file, oid, language, test, skipped, dirty, importsMissing, unresolvedSites, unresolvedNames, reexports, defaultExport, wantedNames }) => ({ id, file, oid, language, test, skipped, dirty, importsMissing: importsMissing ?? false, unresolvedSites, unresolvedNames, reexports, defaultExport, wantedNames })).sort((a, b) => a.file.localeCompare(b.file)),
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
  await git('init', '-q', '-b', 'main')
  await git('config', 'user.email', 'a@b.c')
  await git('config', 'user.name', 'a')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('what a sync writes', () => {
  it('indexes tracked, modified and untracked files, and nothing ignored', async () => {
    put('.gitignore', 'ignored.ts\n')
    put('tracked.ts', 'export function tracked() {}')
    put('changed.ts', 'export function before() {}')
    await commit()
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
    await commit()
    fs.rmSync(path.join(root, 'deleted.ts'))
    enable()
    await sync()
    expect(symbols().map(s => s.qualifiedName)).toEqual(['real.ts#real'])
  })

  it('drops a file deleted from disk but not yet from git', async () => {
    put('a.ts', 'export function a() {}')
    put('b.ts', 'export function b() {}')
    await commit()
    enable()
    await sync()
    fs.rmSync(path.join(root, 'b.ts'))
    await sync()
    expect(symbols().map(s => s.name)).toEqual(['a'])
    expect(codeIndexQueries.status(root).progress).toMatchObject({ files: 1, symbols: 1 })
  })

  it('keeps ids across a save, and writes no row for a reformat', async () => {
    put('a.ts', 'export function keep() { return 1 }\nexport function move() { return 1 }')
    await commit()
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
    await commit()
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
    await commit()
    enable()
    await sync()
    const read = vi.spyOn(fs.promises, 'readFile')
    put('b.ts', 'export function b2() {}')
    await sync()
    // Twice: once for its definitions, and again for its edges once every file's are stored
    expect(new Set(read.mock.calls.map(([file]) => path.basename(String(file))))).toEqual(new Set(['b.ts']))
    read.mockRestore()
  })

  it('re-extracts every file when the extractor answers differently', async () => {
    put('a.ts', 'export function a() {}')
    await commit()
    enable()
    await sync()
    const stored = codeIndexQueries.project(root)!.extractorStamp!
    expect(stored).toBeTruthy()
    codeIndexCommands.setStamp(root, 'another')
    const read = vi.spyOn(fs.promises, 'readFile')
    await sync()
    expect(new Set(read.mock.calls.map(([file]) => path.basename(String(file))))).toEqual(new Set(['a.ts']))
    read.mockRestore()
    expect(codeIndexQueries.project(root)!.extractorStamp).toBe(stored)
  })

  it('counts what it leaves out, by reason', async () => {
    put('large.ts', 'x'.repeat(MAX_FILE_BYTES + 1))
    put('latin.ts', Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    put('good.ts', 'export function good() {}')
    await commit()
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
    await commit()
    enable()
    await sync()
    const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-index-other-')))
    try {
      await execFileWhileWorking('git', ['init', '-q'], { cwd: other })
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
    await commit()
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
    await commit()
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
    await commit()
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
    await commit()
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
  const FILES = ['a.ts', 'dir/b.ts', 'dir/c.tsx', 'd.vue', 'barrel.ts', 'dir/f.spec.ts']
  const fromHere = (file: string, target: string) => { const relative = path.posix.relative(path.posix.dirname(file), target); return relative.startsWith('.') ? relative : `./${relative}` }
  // Names are few on purpose, so that a file's definitions come and go under what other files import
  const bodyOf = (random: ReturnType<typeof randomizer>, file: string) => {
    const others = FILES.filter(other => other !== file && !other.endsWith('.vue'))
    const lines: string[] = []
    if (file === 'barrel.ts') {
      lines.push(`export * from ${JSON.stringify(fromHere(file, random.pick(others)))}`)
      lines.push(`export { fn0 as renamed } from ${JSON.stringify(fromHere(file, random.pick(others)))}`)
    } else {
      const imported = random.pick(others)
      const namespace = random.pick(others)
      lines.push(`import { fn${random.int(3)} as one, renamed } from ${JSON.stringify(fromHere(file, imported))}`)
      lines.push(`import * as space from ${JSON.stringify(fromHere(file, namespace))}`)
      for (let i = random.int(4); i >= 0; i--) lines.push(`export function fn${random.int(3)}(a${random.int(2)}: string) { one(); space.fn${random.int(3)}(); unknown.thing(); fn${random.int(3)}(); return renamed }`)
    }
    const code = lines.join('\n')
    return file.endsWith('.vue') ? `<template><One${random.int(2)} @click="fn${random.int(3)}" /></template>\n<script lang="ts">\n${code}\n</script>` : code
  }

  it.each([1, 2, 3, 4, 5, 6])('over a random history, seed %i', async (seed) => {
    const random = randomizer(seed)
    enable()
    put('base.ts', 'export function base() {}')
    await commit()
    await git('branch', 'other')
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
      } else if (action === 4) await commit(`step ${step}`)
      else {
        await commit(`switch ${step}`)
        await git('checkout', '-q', random.pick(['main', 'other']))
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

describe('the graph', () => {
  const symbolNamed = (name: string) => symbols().find(s => s.name === name)!
  const callers = (name: string) => codeIndexAnswers.callers(symbolNamed(name).id)!

  it('joins a call through an import and within a file, once a pair, weighted by its sites', async () => {
    put('lib.ts', 'export function target() {}\nexport function other() { helper(); helper() }\nfunction helper() {}')
    put('use.ts', "import { target } from './lib.ts'\nexport function caller() { target(); target(); target() }")
    await commit()
    enable()
    await sync()
    // The compiler confirms both, so they are its edges, at full weight
    expect(callers('target').results).toMatchObject([{ name: 'caller', path: 'use.ts', edge: 'code_calls', sites: 3, layer: 'compiler' }])
    expect(callers('helper').results).toMatchObject([{ name: 'other', edge: 'code_calls', sites: 2, layer: 'compiler' }])
    expect(findRelations({ target: symbolNamed('target').id })[0]!.weight).toBeCloseTo(3)
    expect(codeIndexAnswers.callees(symbolNamed('caller').id)!.results.map(r => r.name)).toEqual(['target'])
  })

  it('tells two functions of one name apart by the import, and makes no edge from a member call it cannot type', async () => {
    put('a.ts', 'export function map() {}')
    put('b.ts', 'export function map() {}')
    put('use.ts', "import { map } from './b.ts'\nexport function go(array: number[]) { map(); array.map(x => x) }")
    await commit()
    enable()
    await sync()
    const maps = symbols().filter(s => s.name === 'map')
    const byFile = (file: string) => maps.find(s => s.qualifiedName.startsWith(file))!
    expect(codeIndexAnswers.callers(byFile('b.ts').id)!.results.map(r => r.name)).toEqual(['go'])
    expect(codeIndexAnswers.callers(byFile('a.ts').id)!.results).toEqual([])
  })

  it('makes no edge from a bare name it does not hold, and follows no local that shadows an import', async () => {
    put('lib.ts', 'export function Error() {}\nexport function shadowed() {}')
    put('use.ts', "import { shadowed } from './lib.ts'\nexport function go() { new Error(); const inner = (shadowed: () => void) => shadowed(); return inner }")
    await commit()
    enable()
    await sync()
    expect(callers('Error').results).toEqual([])
    expect(callers('shadowed').results).toEqual([])
  })

  it('follows a member call through its type, which syntax alone cannot', async () => {
    put('lib.ts', 'export class Thing { run() {} }')
    put('use.ts', "import { Thing } from './lib.ts'\nexport function go(thing: Thing) { thing.run() }")
    await commit()
    enable()
    await sync()
    const run = callers('run')
    expect(run.results).toMatchObject([{ name: 'go', path: 'use.ts', edge: 'code_calls', layer: 'compiler' }])
    expect(run.coverage).toEqual({ pendingFiles: 0, unresolvedFiles: 0 })
  })

  it('keeps the syntax edges of a file the compiler does not read', async () => {
    put('lib.ts', 'export function target() {}')
    put('use.js', "import { target } from './lib.ts'\nexport function caller() { target() }")
    await commit()
    enable()
    await sync()
    expect(callers('target').results).toMatchObject([{ name: 'caller', path: 'use.js', layer: 'inferred' }])
  })

  it('follows a method on this, a namespace, a re-export, a class it extends and a package import', async () => {
    put('package.json', JSON.stringify({ name: 'app', imports: { '#lib/*': './src/*' } }))
    put('src/deep.ts', 'export function deep() {}\nexport class Base {}')
    put('src/barrel.ts', "export * from './deep.ts'\nexport { deep as shallow } from './deep.ts'")
    put('src/use.ts', [
      "import * as all from './deep.ts'", "import { deep, shallow as named } from './barrel.ts'", "import { Base } from '#lib/deep.ts'",
      'export class Sub extends Base { a() { this.b() } b() {} }',
      'export function viaNamespace() { all.deep() }', 'export function viaBarrel() { deep() }', 'export function viaRename() { named() }',
    ].join('\n'))
    await commit()
    enable()
    await sync()
    expect(callers('deep').results.map(r => r.name).sort()).toEqual(['viaBarrel', 'viaNamespace', 'viaRename'])
    expect(callers('b').results.map(r => r.name)).toEqual(['a'])
    expect(callers('Base').results).toMatchObject([{ name: 'Sub', edge: 'code_inherits' }])
  })

  it('reads a component tag and a template handler as uses', async () => {
    put('Child.vue', '<template><div /></template>')
    put('Parent.vue', `<template><Child @click="go" /></template>\n<script setup lang="ts">\nimport Child from './Child.vue'\nconst go = () => {}\n</script>`)
    put('default.ts', "export { default } from './Child.vue'")
    await commit()
    enable()
    await sync()
    expect(callers('go').results.map(r => r.name)).toEqual(['Parent'])
    expect(callers('Child').results.map(r => r.name)).toEqual(['Parent'])
  })

  it('a default export follows what it holds, through a rename of it', async () => {
    put('lib.ts', 'export default function named() {}')
    put('use.ts', "import thing from './lib.ts'\nexport function go() { thing() }")
    await commit()
    enable()
    await sync()
    expect(callers('named').results.map(r => r.name)).toEqual(['go'])
    put('lib.ts', 'export default function renamed() {}')
    await sync()
    expect(callers('renamed').results.map(r => r.name)).toEqual(['go'])
  })

  it('gaining a name dirties only the files that ask for it', async () => {
    put('lib.ts', 'export function a() {}')
    put('wantsA.ts', "import { a } from './lib.ts'\nexport function useA() { a() }")
    put('wantsB.ts', "import { b } from './lib.ts'\nexport function useB() { b() }")
    await commit()
    enable()
    await sync()
    const read = vi.spyOn(fs.promises, 'readFile')
    put('lib.ts', 'export function a() {}\nexport function b() {}')
    await sync()
    expect(new Set(read.mock.calls.map(([file]) => path.basename(String(file))))).toEqual(new Set(['lib.ts', 'wantsB.ts']))
    read.mockRestore()
    expect(callers('b').results.map(r => r.name)).toEqual(['useB'])
  })

  it('a save keeps other files\' edges into a symbol that stays', async () => {
    put('lib.ts', 'export function target() { return 1 }')
    put('use.ts', "import { target } from './lib.ts'\nexport function caller() { target() }")
    await commit()
    enable()
    await sync()
    const before = findRelations({ target: symbolNamed('target').id })
    put('lib.ts', '\n\nexport function target() { return 2 }')
    await sync()
    expect(findRelations({ target: symbolNamed('target').id }).map(r => r.id)).toEqual(before.map(r => r.id))
  })

  it('updates a dependent when what it imports appears or goes, through a re-export too', async () => {
    put('deep.ts', 'export function deep() {}')
    put('barrel.ts', "export * from './deep.ts'")
    put('use.ts', "import { deep } from './barrel.ts'\nimport { later } from './later.ts'\nexport function caller() { deep(); later() }")
    await commit()
    enable()
    await sync()
    expect(callers('deep').results.map(r => r.name)).toEqual(['caller'])
    put('deep.ts', 'export function renamed() {}')
    await sync()
    expect(symbols().map(s => s.name)).not.toContain('deep')
    expect(codeIndexQueries.dirtyCount(projectIdOf(root))).toBe(0)
    put('deep.ts', 'export function deep() {}')
    await sync()
    expect(callers('deep').results.map(r => r.name)).toEqual(['caller'])
    put('later.ts', 'export function later() {}')
    await sync()
    expect(callers('later').results.map(r => r.name)).toEqual(['caller'])
  })

  it('a changed manifest re-reads every edge', async () => {
    put('package.json', JSON.stringify({ imports: { '#a': './a.ts' } }))
    put('a.ts', 'export function a() {}')
    put('b.ts', 'export function a() {}')
    put('use.ts', "import { a } from '#a'\nexport function go() { a() }")
    await commit()
    enable()
    await sync()
    put('package.json', JSON.stringify({ imports: { '#a': './b.ts' } }))
    await sync()
    const [b] = symbols().filter(s => s.qualifiedName === 'b.ts#a')
    expect(codeIndexAnswers.callers(b!.id)!.results.map(r => r.name)).toEqual(['go'])
  })

  it('follows a change through a re-export that renames it', async () => {
    put('deep.ts', 'export function deep() {}')
    put('barrel.ts', "export { deep as shallow } from './deep.ts'")
    put('use.ts', "import { shallow } from './barrel.ts'\nexport function go() { shallow() }")
    await commit()
    enable()
    await sync()
    expect(callers('deep').results.map(r => r.name)).toEqual(['go'])
    const before = held()
    put('deep.ts', 'export function other() {}')
    await sync()
    expect(codeIndexQueries.fileSymbols(fileIdOf(projectIdOf(root), 'use.ts'))[0]).toBeDefined()
    expect(query.ids(fileIdOf(projectIdOf(root), 'use.ts')).pickOne()).toMatchObject({ unresolvedSites: 1 })
    put('deep.ts', 'export function deep() {}')
    await sync()
    expect(held().edges.map(({ kind, source, target }) => [kind, source, target])).toEqual(before.edges.map(({ kind, source, target }) => [kind, source, target]))
  })

  it('updates whoever asks for a name a re-export starts or stops giving', async () => {
    put('deep.ts', 'export function deep() {}')
    put('barrel.ts', 'export const nothing = 1')
    put('use.ts', "import { shallow } from './barrel.ts'\nexport function go() { shallow() }")
    await commit()
    enable()
    await sync()
    expect(callers('deep').results).toEqual([])
    put('barrel.ts', "export const nothing = 1\nexport { deep as shallow } from './deep.ts'")
    await sync()
    expect(callers('deep').results.map(r => r.name)).toEqual(['go'])
  })

  it('an import that asks for no name finds a file that appears', async () => {
    put('use.ts', "import './later.ts'\nexport function go() {}")
    await commit()
    enable()
    await sync()
    expect(query.ids(fileIdOf(projectIdOf(root), 'use.ts')).pickOne()).toMatchObject({ importsMissing: true })
    put('later.ts', 'export const later = 1')
    await sync()
    expect(findRelations({ source: fileIdOf(projectIdOf(root), 'use.ts'), kind: EARS.RelKind.CODE_IMPORTS }).map(r => r.target)).toEqual([fileIdOf(projectIdOf(root), 'later.ts')])
    expect(query.ids(fileIdOf(projectIdOf(root), 'use.ts')).pickOne()).toMatchObject({ importsMissing: false })
  })

  it('a file losing a default export and its imports holds what a fresh index would', async () => {
    put('lib.ts', 'export function x() {}')
    put('a.ts', "import { x } from './lib.ts'\nexport default function run() { x() }")
    await commit()
    enable()
    await sync()
    put('a.ts', 'export function run() {}')
    await sync()
    const incremental = held()
    await clearProject()
    enable()
    await sync()
    expect(incremental).toEqual(held())
  })

  it('counts a member of a local as unfollowed, and a local alone as nothing', async () => {
    put('a.ts', 'export function go(items: number[], fn: () => void) { fn(); items.map(fn) }')
    await commit()
    enable()
    await sync()
    expect(query.ids(fileIdOf(projectIdOf(root), 'a.ts')).pickOne()).toMatchObject({ unresolvedSites: 1, unresolvedNames: ['map'] })
  })

  it('lists what is around a file, without the file or tests', async () => {
    put('hub.ts', 'export function hub() {}')
    put('open.ts', "import { hub } from './hub.ts'\nexport function opened() { hub() }")
    put('other.ts', "import { hub } from './hub.ts'\nexport function near() { hub() }")
    put('far.ts', 'export function far() {}')
    put('hub.spec.ts', "import { hub } from './hub.ts'\nexport function aTest() { hub() }")
    await commit()
    enable()
    await sync()
    const names = codeIndexAnswers.codeMap(root, 'open.ts', 5).map(r => r.name)
    expect(names[0]).toBe('hub')
    expect(names).toContain('near')
    expect(names).not.toContain('opened')
    expect(names).not.toContain('aTest')
    expect(codeIndexAnswers.codeMap(root, 'absent.ts', 5)).toEqual([])
  })
})

describe('a semantic diff', () => {
  it('reads a staged change with the index off', async () => {
    put('a.ts', 'export function f() { return 1 }\nexport function gone() {}')
    put('style.ts', 'export function g(){return 1}')
    await commit()
    put('a.ts', 'export function f() { return 2 }\nexport function fresh() {}')
    put('style.ts', 'export function g() {\n  return 1;\n}\n')
    put('new.ts', 'export function brandNew() {}')
    put('notes.md', 'prose')
    await git('add', '-A')
    const diff = await semanticDiff(root, { staged: true })
    expect(diff.changes.map(c => `${c.path} ${c.change} ${c.name}`).sort()).toEqual([
      'a.ts added fresh', 'a.ts body f', 'a.ts removed gone', 'new.ts added brandNew',
    ])
    expect(diff.unread).toEqual(['notes.md'])
    expect(codeIndexQueries.project(root)).toBeUndefined()
  })

  it('reads a range', async () => {
    put('a.ts', 'export function f(a: string) {}')
    await commit()
    const base = (await git('rev-parse', 'HEAD')).trim()
    put('a.ts', 'export function f(b: string) {}')
    fs.rmSync(path.join(root, 'a.ts'))
    put('b.ts', 'export function h() {}')
    await commit()
    const diff = await semanticDiff(root, { base, head: 'HEAD' })
    expect(diff.changes.map(c => `${c.path} ${c.change} ${c.name}`).sort()).toEqual(['a.ts removed f', 'b.ts added h'])
  })
})

describe('searching symbols', () => {
  it('finds by name, in this project, with tests after the rest', async () => {
    put('tests/a.spec.ts', 'export function widgetHelper() {}')
    put('src/a.ts', 'export function widgetMaker(size: number) {}\nexport function other(widgetArg: string) {}')
    await commit()
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
