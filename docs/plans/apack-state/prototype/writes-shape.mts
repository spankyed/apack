// How each function outside a repository writes: one write or several, inside `transact` or not, before or after an `await`.
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
// Run from a checkout that has `typescript` installed: npx tsx <this file> <the checkout to read>
const root = process.argv[2] ?? process.cwd()
const ts = createRequire(join(process.cwd(), 'package.json'))('typescript')
const PRIMITIVES = new Set(['create', 'upsert', 'write', 'untypedCreate', 'untypedUpsert', 'untypedWrite', 'updateRelation', 'removeRelation'])
const EARS = /(^#generated\/ears(\.ts)?$)|(@apackdev\/sdk\/ears)/
const files: string[] = []
const walk = (dir: string): void => { for (const name of readdirSync(dir)) { if (['node_modules', 'dist', '__generated__', 'tests', 'repository'].includes(name)) continue; const at = join(dir, name); if (statSync(at).isDirectory()) walk(at); else if (/\.ts$/.test(name) && !/\.(spec|d)\.ts$/.test(name)) files.push(at) } }
walk(join(root, 'packages/default-setup/src'))
type Fn = { file: string; name: string; writes: number; covered: number; afterAwait: number; awaits: number; broadcasts: number; broadcastBeforeLastWrite: boolean }
const fns: Fn[] = []
for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const imported = new Set<string>(); let transactName = ''
  for (const st of source.statements) {
    if (!ts.isImportDeclaration(st) || !EARS.test(st.moduleSpecifier.text)) continue
    const named = st.importClause?.namedBindings
    if (named && ts.isNamedImports(named)) for (const el of named.elements) { const n = (el.propertyName ?? el.name).text; if (PRIMITIVES.has(n)) imported.add(el.name.text); if (n === 'transact') transactName = el.name.text }
  }
  const isFn = (n: any) => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)
  const nameOf = (n: any): string => { const p = n.parent; if (n.name && ts.isIdentifier(n.name)) return n.name.text; if (p && (ts.isPropertyAssignment(p) || ts.isVariableDeclaration(p)) && p.name) return p.name.getText(source); return `line ${source.getLineAndCharacterOfPosition(n.getStart()).line + 1}` }
  // A function passed straight to transact/reported/etc. belongs to the function around it: the unit is the outermost
  // function that is a handler, so walk with the current top unit and whether a transact call is open.
  const visit = (node: any, unit: Fn | null, covered: boolean, depth: number): void => {
    let u = unit, c = covered, d = depth
    if (isFn(node)) {
      const inlineArg = node.parent && ts.isCallExpression(node.parent) && node.parent.arguments.includes(node)
      if (!unit || !inlineArg) { u = { file: relative(root, file), name: nameOf(node), writes: 0, covered: 0, afterAwait: 0, awaits: 0, broadcasts: 0, broadcastBeforeLastWrite: false }; fns.push(u); c = false }
    }
    if (u && ts.isAwaitExpression(node)) u.awaits++
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (transactName && ts.isIdentifier(callee) && callee.text === transactName) { for (const child of node.arguments) visit(child, u, true, d); return }
      const owner = ts.isPropertyAccessExpression(callee) ? callee.expression : null
      const ownerName = owner ? (ts.isPropertyAccessExpression(owner) ? owner.name.text : ts.isIdentifier(owner) ? owner.text : '') : ''
      const isWrite = (ts.isIdentifier(callee) && imported.has(callee.text)) || /Commands$/.test(ownerName)
      if (u && isWrite) { u.writes++; if (c) u.covered++; if (u.awaits > 0) u.afterAwait++; if (u.broadcasts > 0) u.broadcastBeforeLastWrite = true }
      if (u && ts.isIdentifier(callee) && /^(broadcast|tell|sendToSurface|sendToWindow)$/.test(callee.text)) u.broadcasts++
    }
    ts.forEachChild(node, (child: any) => visit(child, u, c, d))
  }
  visit(source, null, false, 0)
}
const writing = fns.filter((f) => f.writes > 0)
const group = (f: Fn) => /features\/[^/]+\/be\//.test(f.file) ? 'backend system' : /content\/actions\//.test(f.file) ? 'flow action' : /extensions\/steps\//.test(f.file) ? 'step runtime' : 'other'
for (const g of ['backend system', 'flow action', 'step runtime', 'other']) {
  const set = writing.filter((f) => group(f) === g); if (!set.length) continue
  const several = set.filter((f) => f.writes > 1)
  console.log(`\n${g}: ${set.length} functions that write, ${set.reduce((n, f) => n + f.writes, 0)} write calls`)
  console.log(`  one write: ${set.length - several.length}   several writes: ${several.length}`)
  console.log(`  several writes, all inside transact: ${several.filter((f) => f.covered === f.writes).length}`)
  console.log(`  several writes, some outside transact: ${several.filter((f) => f.covered < f.writes).length}`)
  console.log(`  functions with a write after an await: ${set.filter((f) => f.afterAwait > 0).length} (${set.reduce((n, f) => n + f.afterAwait, 0)} writes)`)
  console.log(`  functions that send a message and then write: ${set.filter((f) => f.broadcastBeforeLastWrite).length}`)
}
console.log('\nseveral writes, some outside transact (most first):')
for (const f of writing.filter((f) => f.writes > 1 && f.covered < f.writes).sort((a, b) => b.writes - a.writes).slice(0, 25)) console.log(`  ${String(f.writes).padStart(3)} writes, ${f.covered} covered, ${f.afterAwait} after await  ${f.file.replace('packages/default-setup/src/', '')} :: ${f.name}`)
