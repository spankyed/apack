// Read-only survey: how this repo uses XState, read from the AST rather than from text.
//
//   npx tsx docs/plans/apack-spec/prototype/xstate-survey.mts "$PWD"
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2]!
const require = createRequire(join(root, 'package.json'))
const ts = require('typescript')

const SKIP = new Set(['node_modules', 'dist', 'publish', '.git', 'etc', 'coverage'])
function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mts|vue)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full)
  }
  return out
}

const files: string[] = []
for (const pkg of readdirSync(join(root, 'packages'))) {
  const src = join(root, 'packages', pkg, 'src')
  try { if (statSync(src).isDirectory()) walk(src, files) } catch {}
}

interface Machine {
  file: string
  line: number
  topStates: number
  totalStates: number
  maxDepth: number
  onKeys: number
  withTarget: number
  actionOnly: number
  guards: number
  invokes: number
  features: Set<string>
}

const importCounts = new Map<string, number>()       // imported name -> files importing it
const typeImportCounts = new Map<string, number>()
const callCounts = new Map<string, number>()         // imported value name -> call sites
const memberCalls = new Map<string, number>()
const filesByPkg = new Map<string, number>()
const machines: Machine[] = []
let xstateFiles = 0
let vueXstateFiles = 0

const MEMBERS = new Set(['matches', 'can', 'hasTag', 'getPersistedSnapshot', 'getSnapshot', 'subscribe', 'provide', 'createMachine'])

function textOf(name: any): string | undefined {
  if (!name) return undefined
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text
  return undefined
}

function analyzeTransition(value: any, m: Machine): void {
  if (ts.isArrayLiteralExpression(value)) { for (const el of value.elements) analyzeTransition(el, m); return }
  if (ts.isStringLiteral(value)) { m.withTarget++; return }
  if (ts.isObjectLiteralExpression(value)) {
    let hasTarget = false
    for (const p of value.properties) {
      const key = textOf((p as any).name)
      if (key === 'target') hasTarget = true
      if (key === 'guard') m.guards++
    }
    if (hasTarget) m.withTarget++; else m.actionOnly++
    return
  }
  m.features.add('transition-by-reference')
  m.actionOnly++
}

function analyzeNode(obj: any, m: Machine, depth: number): void {
  m.maxDepth = Math.max(m.maxDepth, depth)
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p)) { m.features.add('spread'); continue }
    const key = textOf((p as any).name)
    const init = (p as any).initializer
    if (!key) continue
    if (key === 'type' && init && ts.isStringLiteral(init)) m.features.add(`type:${init.text}`)
    if (key === 'invoke') {
      m.features.add('invoke')
      m.invokes += init && ts.isArrayLiteralExpression(init) ? init.elements.length : 1
    }
    for (const f of ['after', 'always', 'entry', 'exit', 'tags', 'meta', 'onDone', 'history']) if (key === f) m.features.add(f)
    if (key === 'on' && init && ts.isObjectLiteralExpression(init)) {
      for (const t of init.properties) {
        if (ts.isSpreadAssignment(t)) { m.features.add('on-spread'); continue }
        m.onKeys++
        if ((t as any).initializer) analyzeTransition((t as any).initializer, m)
      }
    }
    if (key === 'states' && init && ts.isObjectLiteralExpression(init)) {
      for (const s of init.properties) {
        if (ts.isSpreadAssignment(s)) { m.features.add('states-spread'); continue }
        m.totalStates++
        if (depth === 0) m.topStates++
        const sInit = (s as any).initializer
        if (sInit && ts.isObjectLiteralExpression(sInit)) analyzeNode(sInit, m, depth + 1)
        else m.features.add('state-by-reference')
      }
    }
  }
}

function scan(file: string, text: string, kind: number): void {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const valueNames = new Set<string>()
  let importsXstate = false
  let importsVue = false
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue
    const mod = (st.moduleSpecifier as any).text as string
    if (mod !== 'xstate' && !mod.startsWith('@xstate/')) continue
    if (mod === 'xstate') importsXstate = true; else importsVue = true
    const clause = st.importClause
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue
    for (const el of clause.namedBindings.elements) {
      const imported = (el.propertyName ?? el.name).text
      const typeOnly = clause.isTypeOnly || el.isTypeOnly
      const map = typeOnly ? typeImportCounts : importCounts
      map.set(imported, (map.get(imported) ?? 0) + 1)
      if (!typeOnly) valueNames.add(el.name.text)
    }
  }
  if (importsXstate) xstateFiles++
  if (importsVue) vueXstateFiles++
  if (importsXstate || importsVue) {
    const pkg = relative(join(root, 'packages'), file).split('/')[0]!
    filesByPkg.set(pkg, (filesByPkg.get(pkg) ?? 0) + 1)
  }
  const visit = (node: any): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && valueNames.has(callee.text)) callCounts.set(callee.text, (callCounts.get(callee.text) ?? 0) + 1)
      if (ts.isPropertyAccessExpression(callee) && MEMBERS.has(callee.name.text)) {
        memberCalls.set(callee.name.text, (memberCalls.get(callee.name.text) ?? 0) + 1)
      }
      const isCreate = (ts.isPropertyAccessExpression(callee) && callee.name.text === 'createMachine')
        || (ts.isIdentifier(callee) && callee.text === 'createMachine')
      if (isCreate && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        const m: Machine = {
          file: relative(root, file), line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          topStates: 0, totalStates: 0, maxDepth: 0, onKeys: 0, withTarget: 0, actionOnly: 0, guards: 0, invokes: 0, features: new Set(),
        }
        analyzeNode(node.arguments[0], m, 0)
        machines.push(m)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  if (!text.includes('xstate') && !text.includes('createMachine')) continue
  if (file.endsWith('.vue')) {
    for (const match of text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) scan(file, match[1]!, ts.ScriptKind.TS)
  } else scan(file, text, ts.ScriptKind.TS)
}

const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ')
console.log(`source files scanned: ${files.length}`)
console.log(`files importing xstate: ${xstateFiles}; importing @xstate/*: ${vueXstateFiles}`)
console.log(`by package: ${sorted(filesByPkg)}`)
console.log(`\nvalue imports (files): ${sorted(importCounts)}`)
console.log(`\ntype imports (files): ${sorted(typeImportCounts)}`)
console.log(`\ncall sites of imported values: ${sorted(callCounts)}`)
console.log(`\nmember calls (any receiver): ${sorted(memberCalls)}`)

console.log(`\nmachines: ${machines.length}`)
const single = machines.filter((m) => m.totalStates <= 1)
const flat = machines.filter((m) => m.totalStates > 1 && m.maxDepth <= 1)
const nested = machines.filter((m) => m.maxDepth > 1)
console.log(`  one state or none: ${single.length}`)
console.log(`  several states, flat: ${flat.length}`)
console.log(`  nested states: ${nested.length}`)
const total = (pick: (m: Machine) => number) => machines.reduce((n, m) => n + pick(m), 0)
console.log(`  transitions: ${total((m) => m.withTarget)} name a target, ${total((m) => m.actionOnly)} only run actions; guards: ${total((m) => m.guards)}; invokes: ${total((m) => m.invokes)}`)
const featureCounts = new Map<string, number>()
for (const m of machines) for (const f of m.features) featureCounts.set(f, (featureCounts.get(f) ?? 0) + 1)
console.log(`  features (machines using): ${sorted(featureCounts)}`)
console.log('\nper machine (states total/top, depth, on-keys, target/action-only, guards, invokes, features):')
for (const m of machines.sort((a, b) => b.totalStates - a.totalStates)) {
  console.log(`  ${String(m.totalStates).padStart(3)}/${String(m.topStates).padEnd(2)} d${m.maxDepth} on=${String(m.onKeys).padEnd(3)} t=${String(m.withTarget).padEnd(3)} a=${String(m.actionOnly).padEnd(3)} g=${String(m.guards).padEnd(2)} i=${m.invokes}  ${m.file}:${m.line}  [${[...m.features].join(',')}]`)
}
