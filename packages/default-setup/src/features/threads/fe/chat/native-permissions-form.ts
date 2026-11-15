import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { ClaudeSettingsOperation, ClaudeSettingsView } from '#features/code/common/native-settings.ts'
import type { ClaudePermissionsOperation } from '#features/code/common/native-permissions.ts'

type Flight = { action: ClaudePermissionsOperation; baseRequest?: string; scope: string; generation: number }
/** Coalesce one original directory draft; completion never doubles as permission submission. */
export function useNativePermissionsForm(state: () => ClaudeSettingsView | undefined, emit: (action: ClaudeSettingsOperation) => void, draft: Ref<string>) {
  const form = computed(() => state()?.snapshot?.permissions?.form), live = computed(() => form.value?.live)
  const flight = ref<Flight>(), edit = ref<string>(), completion = ref<Extract<ClaudePermissionsOperation, { action: 'complete' }>>(), submit = ref<string>(), cancel = ref(false), closing = ref(false), composing = ref(false), dirty = ref(false)
  let scope: string | undefined, generation = 0, scheduled = false, disposed = false
  const busy = computed(() => !!flight.value || edit.value !== undefined || !!completion.value || submit.value !== undefined || cancel.value || closing.value)
  const locked = computed(() => closing.value || cancel.value || submit.value !== undefined || flight.value?.action.action === 'submit' || flight.value?.action.action === 'cancel')
  const canSubmit = computed(() => !!live.value && !locked.value && !composing.value && state()?.status !== 'error' && !state()?.problem)
  const suggestions = computed(() => !busy.value && !composing.value && state()?.status !== 'error' && form.value?.value === draft.value ? live.value?.suggestions ?? [] : [])
  function clear() { flight.value = undefined; edit.value = undefined; completion.value = undefined; submit.value = undefined; cancel.value = false; closing.value = false; composing.value = false }
  function schedule() { if (scheduled || disposed) return; scheduled = true; queueMicrotask(() => { scheduled = false; drain() }) }
  function send(action: ClaudePermissionsOperation) {
    const snapshot = state()?.snapshot
    if (!snapshot || !scope) return
    flight.value = { action, scope, generation, baseRequest: state()?.requestId }
    emit({ kind: 'permissions', revision: snapshot.revision, command: action })
  }
  function drain() {
    if (disposed || flight.value || closing.value || composing.value || !live.value || live.value.id !== scope || state()?.status !== 'ready') return
    if (cancel.value) { cancel.value = false; closing.value = true; send({ action: 'cancel', scope }); return }
    if (edit.value !== undefined) { const value = edit.value; edit.value = undefined; if (value !== form.value!.value) { send({ action: 'change', scope: scope!, value }); return } dirty.value = false }
    if (completion.value) { const action = completion.value; completion.value = undefined; send(action); return }
    if (submit.value !== undefined) { const value = submit.value; submit.value = undefined; send({ action: 'submit', scope, formRevision: live.value.revision, value }); return }
  }
  function change(value: string) {
    if (!live.value || locked.value || disposed) return false
    draft.value = value; dirty.value = true; generation++; edit.value = value; completion.value = undefined; schedule(); return true
  }
  function complete(value: string) {
    const suggestion = suggestions.value.find(item => item.value === value)
    if (!suggestion || !scope || disposed) return
    completion.value = { action: 'complete', scope, value, token: suggestion.token }; schedule()
  }
  function requestSubmit() {
    if (!canSubmit.value) return false
    submit.value = draft.value; if (dirty.value && !(flight.value?.action.action === 'change' && flight.value.generation === generation)) edit.value = draft.value; completion.value = undefined; schedule(); return true
  }
  function requestCancel() {
    if (!live.value || disposed) return false
    if (flight.value?.action.action === 'cancel') return true
    cancel.value = true; edit.value = undefined; completion.value = undefined; submit.value = undefined; schedule(); return true
  }
  function composition(value: boolean) { composing.value = value; if (value) generation++; else schedule() }
  watch([() => live.value?.id, () => form.value?.placeholder, () => state()?.snapshot?.permissions?.title], ([id]) => {
    clear(); dirty.value = false; scope = id; generation++; draft.value = form.value?.value ?? ''
  }, { immediate: true, flush: 'sync' })
  watch([() => state()?.requestId, () => state()?.status, () => live.value?.revision], ([request, status]) => {
    if (status === 'error' || state()?.problem) { flight.value = undefined; edit.value = undefined; completion.value = undefined; submit.value = undefined; cancel.value = false; closing.value = false; return }
    const pending = flight.value
    if (pending && request !== pending.baseRequest && status !== 'pending') {
      flight.value = undefined
      if (pending.scope === scope && pending.generation === generation && edit.value === undefined && !composing.value) { draft.value = form.value?.value ?? ''; dirty.value = false; if (submit.value !== undefined) submit.value = draft.value }
    }
    schedule()
  })
  watch(() => form.value?.value, value => { if (!live.value) draft.value = value ?? ''; else if (!busy.value && !composing.value && value !== undefined) { if (value === draft.value) dirty.value = false; if (!dirty.value) draft.value = value } })
  onBeforeUnmount(() => { disposed = true; clear() })
  return { active: computed(() => !!live.value), flight, busy, locked, composing, canSubmit, suggestions, change, complete, submit: requestSubmit, cancel: requestCancel, composition }
}
