/** The original live keybinding provider's registration shape, not a second key resolver. */
export interface ClaudeNativeActionHandler {
  action: string
  context: string
  singleKey?: boolean
  fallback?: boolean
  handler: () => unknown
}

/**
 * Let the original synchronous dispatcher admit a desktop fallback without invoking a hidden
 * terminal Button. Keep the registry intact: native effects may add/remove registrations during
 * dispatch. Recheck the admitted desktop callback's view/instance before invoking it afterward.
 * Self-contained so the native adapter can include this authored function in its preload.
 */
export function withClaudeDesktopActionFallbacks(
  registry: Map<string, Set<ClaudeNativeActionHandler>>,
  candidates: readonly { action: string; contexts: readonly string[] }[],
  register: (entry: ClaudeNativeActionHandler) => () => void,
  admit: (action: string) => boolean,
  dispatch: () => void,
): void {
  const restores: (() => void)[] = [], releases: (() => void)[] = []
  const entriesSeen = new Set<ClaudeNativeActionHandler>(), setsSeen = new Set<Set<ClaudeNativeActionHandler>>()
  const actions = new Set(candidates.map(candidate => candidate.action))
  let registrations = 0
  function observeEntry(entry: ClaudeNativeActionHandler): void {
    if (entriesSeen.has(entry)) return
    if (entriesSeen.size >= 4096) throw Error('Native key registration bound exceeded')
    entriesSeen.add(entry)
    if (entry.fallback !== true) return
    const original = entry.handler
    const redirected = () => actions.has(entry.action) && admit(entry.action) ? undefined : false
    entry.handler = redirected
    restores.push(() => { if (entry.handler === redirected) entry.handler = original })
  }
  function observeSet(entries: Set<ClaudeNativeActionHandler>): void {
    if (setsSeen.has(entries)) return
    setsSeen.add(entries)
    for (const entry of entries) observeEntry(entry)
    const original = entries.add, descriptor = Object.getOwnPropertyDescriptor(entries, 'add')
    const add = function(this: Set<ClaudeNativeActionHandler>, entry: ClaudeNativeActionHandler) {
      if (this === entries) observeEntry(entry)
      return Reflect.apply(original, this, [entry]) as Set<ClaudeNativeActionHandler>
    }
    entries.add = add
    restores.push(() => {
      if (entries.add !== add) return
      if (descriptor) Object.defineProperty(entries, 'add', descriptor)
      else delete (entries as { add?: unknown }).add
    })
  }
  const originalGet = registry.get, descriptor = Object.getOwnPropertyDescriptor(registry, 'get')
  const get = function(this: Map<string, Set<ClaudeNativeActionHandler>>, action: string) {
    const entries = Reflect.apply(originalGet, this, [action]) as Set<ClaudeNativeActionHandler> | undefined
    if (this === registry && entries) observeSet(entries)
    return entries
  }
  try {
    registry.get = get
    restores.push(() => {
      if (registry.get !== get) return
      if (descriptor) Object.defineProperty(registry, 'get', descriptor)
      else delete (registry as { get?: unknown }).get
    })
    for (const entries of registry.values()) observeSet(entries)
    const unique = new Set<string>()
    for (const candidate of candidates) for (const context of candidate.contexts) {
      const key = JSON.stringify([candidate.action, context])
      if (unique.has(key)) continue
      unique.add(key)
      if (++registrations > 2048) throw Error('Desktop key registration bound exceeded')
      releases.push(register({ action: candidate.action, context, singleKey: true, fallback: true,
        handler: () => admit(candidate.action) ? undefined : false }))
    }
    dispatch()
  } finally {
    for (const release of releases.reverse()) release()
    for (const restore of restores.reverse()) restore()
  }
}
