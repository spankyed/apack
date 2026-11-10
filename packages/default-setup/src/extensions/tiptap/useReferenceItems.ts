import { computed, effectScope, getCurrentScope, onScopeDispose, shallowRef, triggerRef, watch, type Ref } from 'vue'
import { getReferenceCategoryBinding, getReferenceCategoryDeclarations, getReferenceTypeBinding, getReferenceTypeDeclaration,
  onReferenceBindingsChanged, onReferenceDeclarationsChanged, type ReferenceItem } from '@apackdev/sdk/fe/references'

export type ReferenceCategory = string
export type { ReferenceItem }

export function useReferenceItems(category: Ref<string | null>, query: Ref<string>, active: Ref<boolean>) {
  if (!getCurrentScope()) throw new Error('useReferenceItems runs in a component or an effect scope')
  const categories = shallowRef(getReferenceCategoryDeclarations())
  const selected = shallowRef<ReturnType<typeof getReferenceCategoryBinding>>()
  const provided = shallowRef<Readonly<Ref<ReferenceItem[]>>>()
  let providerScope: ReturnType<typeof effectScope> | undefined
  const stopProvider = () => {
    providerScope?.stop()
    providerScope = undefined
    selected.value = undefined
    provided.value = undefined
  }
  const follow = () => {
    categories.value = getReferenceCategoryDeclarations()
    const next = active.value && category.value ? getReferenceCategoryBinding(category.value) : undefined
    if (next === selected.value) {
      // Type eligibility can change without restarting the selected provider.
      triggerRef(provided)
      return
    }
    stopProvider()
    if (!next) return
    selected.value = next
    const scope = effectScope(true)
    providerScope = scope
    try {
      const items = scope.run(() => next.binding.useItems(query))
      if (providerScope === scope && selected.value === next) provided.value = items
      else scope.stop()
    } catch (error) {
      scope.stop()
      if (providerScope === scope) stopProvider()
      throw error
    }
  }
  const stopDeclarations = onReferenceDeclarationsChanged(follow)
  const stopBindings = onReferenceBindingsChanged(follow)
  onScopeDispose(() => { stopDeclarations(); stopBindings(); stopProvider() })
  watch([category, active], follow, { immediate: true, flush: 'sync' })

  const items = computed<ReferenceItem[]>(() => {
    if (!active.value || !category.value || !selected.value) return []
    const q = query.value.toLowerCase()
    return (provided.value?.value ?? []).filter(item => {
      const type = getReferenceTypeDeclaration(item.type)
      return type?.category === category.value && !!getReferenceTypeBinding(item.type)
        && (!q || item.label.toLowerCase().includes(q) || item.shortCode.toLowerCase().includes(q))
    }).slice(0, 25)
  })

  return { items, categories }
}
