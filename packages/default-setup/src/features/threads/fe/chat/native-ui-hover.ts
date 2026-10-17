import { computed, shallowReactive, type ComputedRef, type InjectionKey, type Ref } from 'vue'

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

/** Owned by one mounted native surface. No hook/event dispatch and no global plugin state. */
export function createClaudeHoverSurface(): ClaudeHoverSurface {
  const members = shallowReactive(new Set<ClaudeHoverMember>())
  let target: Node | null = null, coordinates: [number, number] | undefined
  let frame: number | undefined, remaining = 8, disposed = false
  const update = (next: Node | null) => {
    target = next
    for (const member of members) member.underPointer.value = !!next && member.element.contains(next)
  }
  const groups = computed(() => new Set([...members].filter(member => member.underPointer.value).map(member => member.group.value).filter((group): group is string => group !== undefined)))
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
      else { if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined; coordinates = undefined; update(null) }
    },
    refresh,
    dispose() { disposed = true; if (frame !== undefined) cancelAnimationFrame(frame); for (const member of members) member.underPointer.value = false; members.clear() },
  }
}
