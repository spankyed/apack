// Where the app writes to the database. Reads the syntax tree of every source file: a call counts when its callee is
// a write primitive imported from an EARS module, or a method of a repository's `...Commands`.
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
// Run from a checkout that has `typescript` installed: npx tsx <this file> <the checkout to read>
const root = process.argv[2] ?? process.cwd()
const ts = createRequire(join(process.cwd(), 'package.json'))('typescript')
const PRIMITIVES = new Set(['create', 'upsert', 'write', 'transact', 'untypedCreate', 'untypedUpsert', 'untypedWrite', 'updateRelation', 'removeRelation'])
const EARS = /(^#generated\/ears$)|(@apackdev\/sdk\/ears)|(^@elmdb\/ears)|(\/ears(\/index)?(\.ts|\.js)?$)/
const OUTSIDE = /inference|filesystem|terminal|child_process|@apackdev\/git|\/git\b|node:fs|execFile|spawn/
const files: string[] = []
const walk = (dir: string): void => { for (const name of readdirSync(dir)) { if (name === 'node_modules' || name === 'dist' || name === '__generated__' || name === 'tests') continue; const at = join(dir, name); if (statSync(at).isDirectory()) walk(at); else if (/\.(ts|mts)$/.test(name) && !/\.(spec|d)\.ts$/.test(name)) files.push(at) } }
// The server's package was `packages/api` at the commit the plan's figures were read on: whichever is there is read.
for (const pkg of ['packages/default-setup/src', 'packages/apack-host/src', 'packages/apack-sdk/src', 'packages/server/src', 'packages/api/src']) {
  if (existsSync(join(root, pkg))) walk(join(root, pkg))
}
const kind = (file: string): string => {
  const f = relative(root, file)
  if (/default-setup\/src\/features\/[^/]+\/be\/repository\//.test(f)) return 'pack: a repository (where commands are defined)'
  if (/default-setup\/src\/features\/[^/]+\/be\//.test(f)) return 'pack: a backend system and its helpers'
  if (/default-setup\/src\/features\/[^/]+\/fe\//.test(f)) return 'pack: a surface (frontend)'
  if (/default-setup\/src\/content\/actions\//.test(f)) return 'pack: a flow action'
  if (/default-setup\/src\/extensions\/steps\//.test(f)) return 'pack: a step runtime'
  if (/default-setup\/src\//.test(f)) return 'pack: other (' + f.split('/').slice(3, 5).join('/') + ')'
  if (/apack-sdk\/src\/repositories\//.test(f)) return 'sdk: a repository'
  if (/apack-sdk\/src\/content\//.test(f)) return 'sdk: content appliers and writers'
  if (/apack-sdk\/src\//.test(f)) return 'sdk: other (' + f.split('/').slice(3, 4).join('/') + ')'
  if (/apack-host\/src\/(services|settings|app-state|migrations|backup|database)\//.test(f)) return 'host: ' + f.split('/')[3]
  if (/apack-host\/src\/features\//.test(f)) return 'host: its own features'
  if (/apack-host\/src\//.test(f)) return 'host: other (' + f.split('/').slice(3, 4).join('/') + ')'
  return 'server'
}
type Row = { primitives: number; commands: number; files: Set<string>; withOutside: Set<string>; inTransact: number }
const rows = new Map<string, Row>()
const commandMethods = new Map<string, number>()
const perFile: Array<[string, number, number]> = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const imported = new Set<string>()
  let outside = false
  for (const st of source.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const from = st.moduleSpecifier.text
    if (OUTSIDE.test(from)) outside = true
    if (!EARS.test(from)) continue
    const named = st.importClause?.namedBindings
    if (named && ts.isNamedImports(named)) for (const el of named.elements) { if (PRIMITIVES.has((el.propertyName ?? el.name).text)) imported.add(el.name.text) }
  }
  if (/services\.(inference|filesystem|terminal)/.test(text)) outside = true
  let primitives = 0, commands = 0, inTransact = 0
  const visit = (node: any, insideTransact: boolean): void => {
    let inside = insideTransact
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && imported.has(callee.text)) { primitives++; if (insideTransact) inTransact++; if (callee.text === 'transact') inside = true }
      else if (ts.isPropertyAccessExpression(callee)) {
        // repository.xCommands.method(...)  or  xCommands.method(...)
        const owner = callee.expression
        const ownerName = ts.isPropertyAccessExpression(owner) ? owner.name.text : ts.isIdentifier(owner) ? owner.text : ''
        if (/Commands$/.test(ownerName)) { commands++; if (insideTransact) inTransact++; commandMethods.set(`${ownerName}.${callee.name.text}`, (commandMethods.get(`${ownerName}.${callee.name.text}`) ?? 0) + 1) }
      }
    }
    ts.forEachChild(node, (child: any) => visit(child, inside))
  }
  visit(source, false)
  if (!primitives && !commands) continue
  const k = kind(file)
  const row = rows.get(k) ?? rows.set(k, { primitives: 0, commands: 0, files: new Set(), withOutside: new Set(), inTransact: 0 }).get(k)!
  row.primitives += primitives; row.commands += commands; row.inTransact += inTransact; row.files.add(file); if (outside) row.withOutside.add(file)
  perFile.push([relative(root, file), primitives, commands])
}
console.log(`files read: ${files.length}`)
console.log('\nkind'.padEnd(52), 'primitive'.padStart(9), 'command'.padStart(8), 'files'.padStart(6), 'beside an outside effect'.padStart(26), 'inside transact'.padStart(16))
let tp = 0, tc = 0
for (const [k, row] of [...rows].sort((a, b) => (b[1].primitives + b[1].commands) - (a[1].primitives + a[1].commands))) {
  tp += row.primitives; tc += row.commands
  console.log(k.padEnd(52), String(row.primitives).padStart(9), String(row.commands).padStart(8), String(row.files.size).padStart(6), String(row.withOutside.size).padStart(26), String(row.inTransact).padStart(16))
}
console.log('total'.padEnd(52), String(tp).padStart(9), String(tc).padStart(8))
console.log('\nfiles with the most calls:')
for (const [f, p, c] of perFile.sort((a, b) => (b[1] + b[2]) - (a[1] + a[2])).slice(0, 22)) console.log(`  ${String(p + c).padStart(4)}  (${p} primitive, ${c} command)  ${f}`)
console.log(`\ndistinct command methods called: ${commandMethods.size}`)
