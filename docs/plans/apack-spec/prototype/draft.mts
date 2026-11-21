// A draft: data to edit in place, from which a new value is made without touching the old one.
//
//   const { value, touched } = produce(data, (draft) => { draft.titles[id] = title })
//
// A state's data is plain: objects, arrays and values that are replaced whole. That is all a draft goes inside.
// Anything else (a class instance, a Map, a Date) can be read and replaced whole, and refuses to be edited.

export type Path = ReadonlyArray<string>

/** What a draft was made over, the copy it writes to once something changes, and the drafts handed out inside it. */
interface Node {
  readonly base: object
  copy: object | undefined
  readonly around: Node | undefined
  readonly path: Path
  /** The draft handed out for each key, so that reading the same place twice is the same draft. */
  readonly inside: Map<string, { node: Node; proxy: object }>
}

const NODE = Symbol('draft')
const WHOLE = Symbol('whole')
const isPlain = (value: unknown): value is object => {
  if (typeof value !== 'object' || value === null) return false
  if (Array.isArray(value)) return true
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * `fixed` says the outermost object's keys are not the edit's to change: its values can be edited and replaced, and
 * a key can be neither added nor removed. The write that tries is the one that throws, so the error is on its line.
 */
export function produce<T extends object>(base: T, edit: (draft: T) => void, options: { fixed?: boolean } = {}): { value: T; touched: Path[] } {
  const touched = new Map<string, Path>()
  let open = true
  const closed = (): never => { throw new Error('A draft was used after the handler it was given to returned') }

  const latest = (node: Node): Record<string, unknown> => (node.copy ?? node.base) as Record<string, unknown>

  /** Makes a node, and every node around it, write to a copy of its own from here on. */
  const own = (node: Node): Record<string, unknown> => {
    if (!node.copy) {
      node.copy = Array.isArray(node.base) ? [...node.base] : { ...node.base }
      if (node.around) own(node.around)
    }
    return node.copy as Record<string, unknown>
  }

  const note = (node: Node, key: string): void => {
    const path = [...node.path, key]
    touched.set(JSON.stringify(path), path)
  }

  /** What a draft or a plain value stands for right now, with every draft inside it resolved. */
  const settle = (node: Node): object => {
    if (!node.copy) return node.base
    const made = node.copy as Record<string, unknown>
    for (const [key, held] of node.inside) if (held.node.copy && made[key] === held.node.base) made[key] = settle(held.node)
    return made
  }
  const plainOf = (value: unknown): unknown => {
    if (typeof value !== 'object' || value === null) return value
    const whole = (value as { [WHOLE]?: object })[WHOLE]
    if (whole) return whole
    const node = isPlain(value) ? (value as { [NODE]?: Node })[NODE] : undefined
    return node ? settle(node) : value
  }

  /**
   * A value that is not plain data, as a draft hands it out: it reads as itself and its methods run on the real
   * thing, and assigning to it throws. Editing it would change the one object every earlier value still points at.
   */
  const whole = (value: object, path: Path): object => {
    const refuse = (): never => { throw new Error(`${path.join('.')} is not plain data, so it cannot be edited in a draft. Replace it whole`) }
    return new Proxy(value, {
      get(target, key) {
        if (key === WHOLE) return target
        const found = Reflect.get(target, key, target)
        return typeof found === 'function' ? found.bind(target) : found
      },
      set: refuse, deleteProperty: refuse, defineProperty: refuse,
    })
  }

  const draftOf = (base: object, around: Node | undefined, path: Path): object => {
    const node: Node = { base, copy: undefined, around, path, inside: new Map() }
    const isArray = Array.isArray(base)
    // The target is never read: it only says whether this is an array. Every trap answers from the node.
    return new Proxy(isArray ? [] : {}, {
      get(_, key) {
        if (key === NODE) return node
        if (!open) closed()
        const value = Reflect.get(latest(node), key)
        if (typeof key === 'symbol' || typeof value !== 'object' || value === null) return value
        if (!isPlain(value)) return whole(value, [...node.path, key])
        const held = node.inside.get(key)
        if (held && held.node.base === value) return held.proxy
        const proxy = draftOf(value, node, [...node.path, key])
        node.inside.set(key, { node: (proxy as { [NODE]: Node })[NODE], proxy })
        return proxy
      },
      set(_, key, value) {
        if (!open) closed()
        if (typeof key === 'symbol') return false
        if (options.fixed && !node.around && !(key in node.base)) throw new Error(`There is no field ${key} to change`)
        const next = plainOf(value)
        if (Object.is(latest(node)[key], next) && key in latest(node)) return true
        own(node)[key] = next
        node.inside.delete(key)
        note(node, key)
        return true
      },
      deleteProperty(_, key) {
        if (!open) closed()
        if (typeof key === 'symbol' || !(key in latest(node))) return true
        if (options.fixed && !node.around) throw new Error(`The field ${key} cannot be removed`)
        delete own(node)[key]
        node.inside.delete(key)
        note(node, key)
        return true
      },
      has: (_, key) => key in latest(node),
      ownKeys: () => Reflect.ownKeys(latest(node)),
      getOwnPropertyDescriptor(_, key) {
        const found = Reflect.getOwnPropertyDescriptor(latest(node), key)
        // An array's length cannot be reported configurable; everything else can be, since the target holds nothing.
        return found && { ...found, writable: true, configurable: !(isArray && key === 'length') }
      },
      getPrototypeOf: () => Object.getPrototypeOf(base),
      defineProperty: () => { throw new Error('A draft takes assignments, not property definitions') },
    })
  }

  const draft = draftOf(base, undefined, [])
  let returned: unknown
  try { returned = edit(draft as T) } finally { open = false }
  // Both would otherwise do nothing and say nothing.
  if (returned instanceof Promise) {
    // What it goes on to do fails against the closed draft; that failure is this one, already reported.
    returned.catch(() => {})
    throw new Error('An edit cannot be async: a draft is closed as soon as the function returns')
  }
  if (returned !== undefined) throw new Error('An edit changes its draft and returns nothing. To replace a field, give the field')
  return { value: settle((draft as { [NODE]: Node })[NODE]) as T, touched: [...touched.values()] }
}
