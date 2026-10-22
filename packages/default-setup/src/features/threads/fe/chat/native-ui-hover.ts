import { computed, inject, provide, watch, shallowRef, onBeforeUnmount, shallowReactive, type ComputedRef, type InjectionKey, type Ref } from 'vue'

interface ClaudeHoverMember { element: HTMLElement; underPointer: Ref<boolean>; group: ComputedRef<string | undefined> }
export interface ClaudeHoverSurface {
  groups: ComputedRef<ReadonlySet<string>>
  register: (member: ClaudeHoverMember) => () => void
  point: (event: PointerEvent) => void
  leave: (event: PointerEvent) => void
  refresh: () => void
  dispose: () => void
}
export const claudeHoverSurface: InjectionKey<ClaudeHoverSurface> = Symbol('claude-hover-surface')
export const claudeHoverBox: InjectionKey<ComputedRef<boolean>> = Symbol('claude-hover-box')

interface ClaudeHoverGroups {
  groups: ComputedRef<ReadonlySet<string>>
  register: (groups: ComputedRef<ReadonlySet<string>>) => () => void
  dispose: () => void
}
const claudeHoverGroups: InjectionKey<Readonly<Ref<ClaudeHoverGroups | undefined>>> = Symbol('claude-hover-groups')

function createClaudeHoverGroups(): ClaudeHoverGroups {
  const sources = shallowReactive(new Set<ComputedRef<ReadonlySet<string>>>())
  let disposed = false
  return {
    groups: computed(() => new Set([...sources].flatMap(source => [...source.value]))),
    register(source) { if (!disposed) sources.add(source); return () => { sources.delete(source) } },
    dispose() { disposed = true; sources.clear() },
  }
}

/** One original UI attachment/view in this window; a replacement never inherits the old pointer. */
export function provideClaudeHoverGroups(identity: () => string | undefined): void {
  const scope = shallowRef<ClaudeHoverGroups>()
  provide(claudeHoverGroups, scope)
  watch(identity, (key, _previous, cleanup) => {
    const held = key === undefined ? undefined : createClaudeHoverGroups()
    scope.value = held
    cleanup(() => held?.dispose())
  }, { immediate: true, flush: 'sync' })
  onBeforeUnmount(() => { scope.value?.dispose(); scope.value = undefined })
}

export function useClaudeHoverSurface(): ClaudeHoverSurface {
  return createClaudeHoverSurface(inject(claudeHoverGroups, undefined))
}

/** Owned by one mounted native surface. No hook/event dispatch and no global plugin state. */
export function createClaudeHoverSurface(shared?: Readonly<Ref<ClaudeHoverGroups | undefined>>): ClaudeHoverSurface {
  const members = shallowReactive(new Set<ClaudeHoverMember>())
  let target: Node | null = null, coordinates: [number, number] | undefined
  let frame: number | undefined, remaining = 8, disposed = false
  const update = (next: Node | null) => {
    target = next
    for (const member of members) member.underPointer.value = !!next && member.element.contains(next)
  }
  const localGroups = computed(() => new Set([...members].filter(member => member.underPointer.value).map(member => member.group.value).filter((group): group is string => group !== undefined)))
  const clearPointer = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined; coordinates = undefined; update(null)
  }
  const stopSharing = shared ? watch(shared, (scope, _previous, cleanup) => {
    clearPointer()
    if (scope) cleanup(scope.register(localGroups))
  }, { immediate: true, flush: 'sync' }) : undefined
  const groups = computed(() => shared ? shared.value?.groups.value ?? new Set<string>() : localGroups.value)
  const refresh = () => {
    if (disposed || frame !== undefined || !coordinates || remaining <= 0 || typeof document.elementFromPoint !== 'function') return
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (disposed || !coordinates) return
      remaining--
      update(document.elementFromPoint(...coordinates))
    })
  }
  return {
    groups,
    register(member) { members.add(member); member.underPointer.value = !!target && member.element.contains(target); refresh(); return () => { member.underPointer.value = false; members.delete(member) } },
    point(event) { remaining = 8; coordinates = [event.clientX, event.clientY]; update(event.target instanceof Node ? event.target : null); refresh() },
    leave(event) {
      const root = event.currentTarget
      if (root instanceof Node && event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) update(event.relatedTarget)
      else clearPointer()
    },
    refresh,
    dispose() { disposed = true; stopSharing?.(); clearPointer(); members.clear() },
  }
}
