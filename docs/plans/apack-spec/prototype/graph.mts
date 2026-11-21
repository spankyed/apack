// Static analysis of states written on the prototype. Nothing here runs one: it asks the TypeScript checker what
// each handler can return, reads the moves off those types, and reads who each state reaches off its code.
//
//   npx tsx docs/plans/apack-spec/prototype/graph.mts docs/plans/apack-spec/prototype/search.mts
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const file = resolve(process.argv[2]!)
const ts = createRequire(resolve('package.json'))('typescript')
const program = ts.createProgram([file], {
  strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, skipLibCheck: true, types: ['node'],
})
const checker = program.getTypeChecker()

type Type = any
const members = (type: Type): Type[] => (type.isUnion() ? type.types : [type])
const real = (type: Type): Type[] => members(type).filter((m: Type) => !(m.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Null | ts.TypeFlags.Never)))
const typeOf = (symbol: any): Type => checker.getTypeOfSymbol(symbol)
const unwrap = (type: Type): Type[] => real(type).flatMap((m: Type) => (m.symbol?.name === 'Promise' ? real(checker.getTypeArguments(m)[0]) : [m]))
const literalsOf = (type: Type): string[] => members(type).filter((m: Type) => m.isStringLiteral()).map((m: Type) => m.value as string)
const join = (within: string, name: string): string => (within ? `${within}.${name}` : name)

function analyse(title: string, shape: Type, events: string[], asks: string[], def: Type, reaches: string[]): void {
  const moves: Array<{ from: string; on: string; to: string[] }> = []
  const stays: string[] = []
  const answers: string[] = []
  const takes = new Set<string>()
  const entered = new Set<string>()
  const starts = new Map<string, string>()
  const where = (path: string, name: string): string => (path ? `${name} in ${path}` : name)

  /** A returned value that says `at` is a move to that path. Anything else changes data and stays. */
  const read = (returned: Type[], path: string, on: string): void => {
    const to = new Set<string>()
    for (const value of returned) { const at = value.getProperty?.('at'); if (at) for (const target of literalsOf(typeOf(at))) to.add(target) }
    if (to.size) moves.push({ from: path || 'anywhere', on, to: [...to] })
    else stays.push(where(path, on))
  }

  const walk = (level: Type, path: string): void => {
    for (const property of level.getProperties()) {
      const type = real(typeOf(property))[0]
      if (!type) continue
      if (property.name === 'on') {
        for (const handler of type.getProperties()) {
          takes.add(handler.name)
          const signature = real(typeOf(handler))[0]?.getCallSignatures()[0]
          if (signature) read(unwrap(signature.getReturnType()), path, handler.name)
        }
      } else if (property.name === 'asks') {
        for (const handler of type.getProperties()) {
          takes.add(handler.name)
          answers.push(where(path, handler.name))
          // An answer that comes with a change: `answered(answer, next)`. Its `next` is read as any handler's return is.
          const signature = real(typeOf(handler))[0]?.getCallSignatures()[0]
          const changes = signature ? unwrap(signature.getReturnType()).filter((value: Type) => value.getProperty?.('next') && value.getProperty?.('answer')) : []
          if (changes.length) read(changes.flatMap((value: Type) => real(typeOf(value.getProperty('next')))), path, `${handler.name} (answering)`)
        }
      } else if (property.name === 'run') {
        const returned = type.getCallSignatures()[0] ? unwrap(type.getCallSignatures()[0].getReturnType()) : []
        if (returned.length) read(returned, path, '(its work ends)')
      } else if (property.name === 'failed') {
        const signature = type.getCallSignatures()[0]
        if (signature) read(unwrap(signature.getReturnType()), path, '(its work fails)')
      } else if (property.name === 'start') {
        for (const at of literalsOf(type)) starts.set(path, at)
      } else if (property.name === 'states') {
        for (const inner of type.getProperties()) { const innerType = real(typeOf(inner))[0]; if (innerType) walk(innerType, join(path, inner.name)) }
      }
    }
  }
  walk(def, '')

  /** Entering a state also enters the one it starts at, and so on down. */
  const enter = (path: string): void => {
    for (let at = path; ; ) {
      if (at) { if (entered.has(at)) break; entered.add(at); for (let cut = at.lastIndexOf('.'); cut > 0; cut = at.lastIndexOf('.', cut - 1)) entered.add(at.slice(0, cut)) }
      const next = starts.get(at)
      if (next === undefined) break
      at = join(at, next)
    }
  }
  enter('')
  for (const move of moves) for (const target of move.to) enter(target)

  const declared: string[] = []
  const startsStates: string[] = []
  const survey = (of: Type, within: string): void => {
    // What it starts is declared in the shape: a state, or one for each key.
    const started = of.getProperty('starts')
    if (started) for (const each of typeOf(started).getProperties()) startsStates.push(`${each.name}${typeOf(each).getProperty('_each') ? ' (one for each key)' : ''}${within ? ` in ${within}` : ''}`)
    const states = of.getProperty('states')
    if (!states) return
    for (const inner of typeOf(states).getProperties()) { declared.push(join(within, inner.name)); survey(typeOf(inner), join(within, inner.name)) }
  }
  survey(shape, '')

  console.log(`\n${title}`)
  if (declared.length) console.log(`  states: ${declared.join(', ')}`)
  for (const move of moves) console.log(`    ${move.from.padEnd(16)} ${move.on.padEnd(18)} → ${move.to.join(' | ')}`)
  if (stays.length) console.log(`  changes data only: ${stays.join(', ')}`)
  if (answers.length) console.log(`  answers: ${answers.join(', ')}`)
  if (startsStates.length) console.log(`  starts: ${startsStates.join(', ')}`)
  if (reaches.length) console.log(`  reaches: ${reaches.join(', ')}`)
  const findings: string[] = []
  for (const taken of [...events, ...asks]) if (!takes.has(taken)) findings.push(`nothing takes ${taken}`)
  for (const name of declared) if (!entered.has(name)) findings.push(`${name} is never entered`)
  console.log(`  findings: ${findings.length ? findings.join('; ') : 'none'}`)
}

const VERBS = new Set(['tell', 'ask', 'broadcast'])
const visit = (node: any): void => {
  // state<Shape, Events, Asks>()(definition)
  if (ts.isCallExpression(node) && ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'state' && node.expression.typeArguments?.length && node.arguments.length === 1 && ts.isObjectLiteralExpression(node.arguments[0])
    // A definition written to show what does not compile is not one to describe.
    && !node.getFullText().includes('@ts-expect-error')) {
    const [shapeNode, eventNode, askNode] = node.expression.typeArguments
    const eventType = eventNode ? checker.getTypeFromTypeNode(eventNode) : undefined
    const events = eventType ? members(eventType).flatMap((m: Type) => { const t = m.getProperty?.('type'); return t ? literalsOf(typeOf(t)) : [] }) : []
    const asks = askNode ? checker.getTypeFromTypeNode(askNode).getProperties().map((p: any) => p.name as string) : []
    const reaches = new Set<string>()
    const scan = (inner: any): void => {
      if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && VERBS.has(inner.expression.text) && inner.arguments[0]) {
        const target = inner.arguments[0]
        reaches.add(`${inner.expression.text} ${ts.isCallExpression(target) ? `its ${target.arguments[0].getText()}` : target.getText()}`)
      }
      ts.forEachChild(inner, scan)
    }
    scan(node.arguments[0])
    analyse(shapeNode.getText(), checker.getTypeFromTypeNode(shapeNode), events, asks, checker.getTypeAtLocation(node.arguments[0]), [...reaches])
  }
  ts.forEachChild(node, visit)
}
visit(program.getSourceFile(file)!)
