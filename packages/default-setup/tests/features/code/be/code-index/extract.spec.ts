import { describe, expect, it } from 'vitest'
import { extractFile, extractorStamp, languageOf, type Definition } from '#features/code/be/code-index/extract.ts'
import { diffDefinitions } from '#features/code/be/code-index/semantic-diff.ts'

const definitions = (path: string, source: string): Definition[] => {
  const extraction = extractFile(path, source)
  if (!extraction.ok) throw new Error(extraction.error)
  return extraction.definitions
}
const names = (path: string, source: string) => definitions(path, source).map(d => `${d.kind} ${d.local}${d.exported ? ' exported' : ''}`)
const one = (source: string, local: string) => definitions('a.ts', source).find(d => d.local === local)!

describe('what a file defines', () => {
  it('reads each form of a TypeScript definition', () => {
    expect(names('a.ts', `
      export function f() {}
      function g() {}
      export class C { static s = 1; #p = 2; m() {} a = () => 1; }
      export interface I { x: number }
      export type U = string
      enum E { A }
      namespace N { export const v = 1 }
      export const arrow = async () => 1
      const object = { m() {}, a: () => 1, plain: 2 }
      const { d, e: [h] } = source
    `)).toEqual([
      'function f exported', 'function g',
      'class C exported', 'property C.s exported', 'property C.#p exported', 'method C.m exported', 'method C.a exported',
      'interface I exported', 'type U exported', 'enum E', 'namespace N', 'variable N.v exported',
      'function arrow exported', 'variable object', 'method object.m', 'method object.a', 'variable d', 'variable h',
    ])
  })

  it('marks what an export list names, and its members', () => {
    expect(names('a.ts', 'class C { m() {} }\nconst o = 1\nexport { C, o as renamed }')).toEqual([
      'class C exported', 'method C.m exported', 'variable o exported',
    ])
  })

  it('reads a default export, named or not', () => {
    expect(names('a.ts', 'export default function named() {}')).toEqual(['function named exported'])
    expect(names('a.ts', 'export default () => 1')).toEqual(['function default exported'])
    expect(names('a.ts', 'export default { go() {} }')).toEqual(['variable default exported', 'method default.go exported'])
  })

  it('reads a CommonJS module', () => {
    expect(names('a.cjs', 'exports.a = function () {}\nmodule.exports.b = () => 1\nmodule.exports = { c() {} }')).toEqual([
      'function a exported', 'function b exported', 'variable default exported', 'method default.c exported',
    ])
  })

  it('reads JSX', () => {
    expect(names('a.tsx', 'export const View = () => <div />')).toEqual(['function View exported'])
  })

  it('reads a component: itself, and each script block, at its line in the file', () => {
    const found = definitions('src/Panel.vue', '<template><div @click="go" /></template>\n<script setup lang="ts">\nconst go = (): void => {}\n</script>')
    expect(found.map(d => `${d.kind} ${d.local}`)).toEqual(['component <Panel>', 'function go'])
    expect(found[1]).toMatchObject({ line: 3, signature: 'const go = (): void =>' })
  })

  it('tells overloads and a getter from its setter by ordinal', () => {
    const found = definitions('a.ts', 'function f(a: string): void; function f(a: number): void; function f(a: unknown) {}\nclass C { get g() { return 1 } set g(v) {} }')
    expect(found.filter(d => d.local === 'f').map(d => d.ordinal)).toEqual([0, 1, 2])
    expect(found.filter(d => d.local === 'C.g').map(d => d.ordinal)).toEqual([0, 1])
  })

  it('reads through an error the parser recovers from, and fails on one it cannot', () => {
    expect(names('a.ts', 'export function f() {}\nconst a = 1\nconst a = 2')).toContain('function f exported')
    expect(extractFile('a.ts', 'export function f() {}\nconst = 1').ok).toBe(false)
  })

  it("answers a file it can't read as failed, and a path it doesn't read as no language", () => {
    expect(languageOf('a.py')).toBeNull()
    expect(languageOf('dir.ts/file')).toBeNull()
    expect(extractFile('a.py', 'x').ok).toBe(false)
  })
})

describe('what moves a hash', () => {
  it('a reformat, a comment and a quote style move neither', () => {
    const a = one(`export function f(a: string) { return call('x', 1) }`, 'f')
    const b = one(`// new comment\nexport   function f(\n  a: string,\n) {\n  /* c */ return call("x", 1);\n}\n`, 'f')
    expect(b.signatureHash).toBe(a.signatureHash)
    expect(b.bodyHash).toBe(a.bodyHash)
  })

  it('a renamed parameter moves only the signature', () => {
    const a = one('function f(a: string) { return 1 }', 'f')
    const b = one('function f(b: string) { return 1 }', 'f')
    expect(b.signatureHash).not.toBe(a.signatureHash)
    expect(b.bodyHash).toBe(a.bodyHash)
  })

  it('a changed statement moves only the body', () => {
    for (const [before, after, local] of [
      ['function f() { return 1 }', 'function f() { return 2 }', 'f'],
      ['const f = () => 1', 'const f = () => 2', 'f'],
      ['class C { m() { return 1 } }', 'class C { m() { return 2 } }', 'C.m'],
      ['const o = { m() { return 1 } }', 'const o = { m() { return 2 } }', 'o.m'],
      ['const v = 1', 'const v = 2', 'v'],
    ] as const) {
      const a = one(before, local)
      const b = one(after, local)
      expect(b.signatureHash, before).toBe(a.signatureHash)
      expect(b.bodyHash, before).not.toBe(a.bodyHash)
    }
  })

  it('a changed member leaves its class or object alone', () => {
    expect(one('class C { m() { return 2 } }', 'C')).toEqual(one('class C { m() { return 1 } }', 'C'))
    const a = one('const o = { m() { return 1 }, v: 1 }', 'o')
    expect(one('const o = { m() { return 2 }, v: 1 }', 'o').bodyHash).toBe(a.bodyHash)
    expect(one('const o = { m() { return 1 }, v: 2 }', 'o').bodyHash).not.toBe(a.bodyHash)
  })

  it('a changed template moves the component', () => {
    const body = (template: string) => definitions('C.vue', `<template>${template}</template>`)[0]!.bodyHash
    expect(body('<a />')).not.toBe(body('<b />'))
    expect(body('<a />')).toBe(body('<a  />'))
  })
})

describe('a semantic diff of one file', () => {
  const diff = (before: string, after: string) => diffDefinitions('a.ts', definitions('a.ts', before), definitions('a.ts', after)).map(c => `${c.change} ${c.name}`)

  it('names each definition by what happened to it', () => {
    expect(diff(
      'function same() {}\nfunction body() { return 1 }\nfunction sig(a) {}\nfunction gone() {}',
      'function same() {}\nfunction body() { return 2 }\nfunction sig(b) {}\nfunction fresh() {}',
    )).toEqual(['body body', 'signature sig', 'added fresh', 'removed gone'])
  })

  it('reports nothing for a reformat', () => {
    expect(diff('function f(){return 1}', '\n\nfunction f() {\n  return 1;\n}\n')).toEqual([])
  })
})

it('the stamp is stable, and covers every form', () => {
  expect(extractorStamp()).toBe(extractorStamp())
  expect(extractorStamp()).toMatch(/^[\w-]{16}$/)
})
