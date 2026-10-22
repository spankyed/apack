<template>
  <section data-testid="native-mcp-form" aria-label="MCP server input" class="native-mcp-form">
    <header>
      <h3>{{ form.serverName }} requests input</h3>
      <p class="whitespace-pre-wrap break-words">{{ form.message }}</p>
    </header>
    <div class="fields">
      <p v-if="schemaProblem" role="alert">{{ schemaProblem }} Use the native interface to complete this form, or cancel.</p>
      <template v-for="field in fields" :key="field.name">
        <div class="space-y-1">
          <label :for="ids(field.name)">{{ field.title }}{{ field.required ? ' *' : '' }}</label>
          <p v-if="field.description" class="description">{{ field.description }}</p>
          <fieldset v-if="field.type === 'array'" :id="ids(field.name)" :aria-label="field.title" :disabled="finishing">
            <label v-for="option in field.options" :key="option.value" class="option"><input type="checkbox" :checked="selected(field, option.value)" @change="toggle(field, option.value)" />{{ option.label }}</label>
          </fieldset>
          <select v-else-if="field.type === 'boolean' || field.options" :id="ids(field.name)" :disabled="finishing" :value="value(field) === undefined ? '' : String(value(field))" @change="choose(field, ($event.target as HTMLSelectElement).value)">
            <option value="">Select…</option>
            <template v-if="field.type === 'boolean'"><option value="true">Yes</option><option value="false">No</option></template>
            <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <input v-else :id="ids(field.name)" type="text" :disabled="finishing" :inputmode="field.type === 'number' || field.type === 'integer' ? 'decimal' : undefined" :value="value(field) ?? ''" :placeholder="field.format === 'date' || field.format === 'date-time' ? 'Enter a date' : undefined" @input="edit(field.name, ($event.target as HTMLInputElement).value)" />
          <p v-if="form.errors[field.name]" role="alert" class="error">{{ form.errors[field.name] }}</p>
          <p v-if="form.resolvingFields.includes(field.name)" role="status" class="description">Checking date…</p>
        </div>
      </template>
      <p v-if="operation?.status === 'error'" role="alert" class="error">{{ operation.problem }}</p>
    </div>
    <footer>
      <button type="button" class="accept" :disabled="!!schemaProblem || finishing || !form.ready || !!form.resolvingFields.length" @click="decide('accept')">{{ finishing ? 'Sending…' : 'Submit' }}</button>
      <button type="button" :disabled="finishing || !form.ready" @click="decide('decline')">Decline</button>
      <button type="button" :disabled="cancelling || !form.ready" @click="decide('cancel')">Cancel</button>
    </footer>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import type { ClaudeNativeMcpForm, ClaudeNativeMcpFormOperation } from '#features/code/common/native-mcp-form.ts'
import { parseMcpElicitationForm, type ClaudeMcpFormField, type ClaudeMcpFormValue } from '#features/code/common/mcp-elicitation-form.ts'
const props = defineProps<{ form: ClaudeNativeMcpForm; operation?: { sequence: number; status: 'pending' | 'done' | 'error'; problem?: string } }>()
const emit = defineEmits<{ operate: [operation: ClaudeNativeMcpFormOperation] }>()
const baseId = useId(), ids = (name: string) => baseId + '-' + props.form.propertyOrder.indexOf(name)
const parsed = computed(() => { try { return { fields: parseMcpElicitationForm(props.form.schema, props.form.propertyOrder).fields } } catch { return { fields: [], problem: 'This form cannot be displayed here.' } } })
const fields = computed(() => parsed.value.fields), schemaProblem = computed(() => parsed.value.problem)
const drafts = ref<Record<string, ClaudeMcpFormValue | null>>({}), finishing = ref(false), cancelling = ref(false)
let inFlight: ClaudeNativeMcpFormOperation | undefined, baseline = 0
const queue: ClaudeNativeMcpFormOperation[] = []
function value(field: ClaudeMcpFormField): ClaudeMcpFormValue | undefined {
  if (Object.hasOwn(drafts.value, field.name)) return drafts.value[field.name] ?? undefined
  if (!field.options && ['string', 'number', 'integer'].includes(field.type) && props.form.currentFieldIndex === props.form.propertyOrder.indexOf(field.name)) return props.form.textInputValue
  return props.form.values[field.name]
}
function drain() {
  if (inFlight || !queue.length || !props.form.ready || props.operation?.status === 'pending') return
  inFlight = queue.shift()!; baseline = props.operation?.sequence ?? 0; emit('operate', inFlight)
}
function enqueue(action: ClaudeNativeMcpFormOperation) {
  const last = queue.at(-1)
  if (action.operation === 'edit' && last?.operation === 'edit' && last.field === action.field) queue[queue.length - 1] = action
  else queue.push(action)
  drain()
}
function edit(field: string, value: ClaudeMcpFormValue | null) {
  drafts.value = { ...drafts.value, [field]: value }; enqueue({ operation: 'edit', field, value })
}
function selected(field: ClaudeMcpFormField, option: string) { const current = value(field); return Array.isArray(current) && current.includes(option) }
function toggle(field: ClaudeMcpFormField, option: string) { const current = value(field), values = Array.isArray(current) ? current : []; edit(field.name, values.includes(option) ? values.filter(item => item !== option) : [...values, option]) }
function choose(field: ClaudeMcpFormField, value: string) { edit(field.name, value === '' ? null : field.type === 'boolean' ? value === 'true' : value) }
function decide(operation: 'accept' | 'decline' | 'cancel') { finishing.value = true; if (operation === 'cancel') { cancelling.value = true; queue.splice(0) } enqueue({ operation }) }
watch(() => [props.operation?.sequence, props.operation?.status, props.form.token] as const, () => {
  if (inFlight && (props.operation?.sequence ?? 0) > baseline && props.operation?.status !== 'pending') {
    const prior = inFlight; inFlight = undefined
    if (props.operation?.status === 'error') { queue.splice(0); finishing.value = false; cancelling.value = false; drafts.value = {} }
    else {
      if (prior.operation === 'edit' && !queue.some(action => action.operation === 'edit' && action.field === prior.field)) { const next = { ...drafts.value }; delete next[prior.field]; drafts.value = next }
      if (prior.operation !== 'edit') { finishing.value = false; cancelling.value = false }
    }
  }
  drain()
})
</script>
<style scoped>
.native-mcp-form { display: flex; flex-direction: column; flex: 0 1 26rem; min-height: 10rem; max-height: 45vh; margin: .5rem 1rem; overflow: hidden; border: 1px solid rgb(255 255 255 / .12); border-radius: .8rem; background: #202020; font-size: .875rem; color: #e5e5e5; }
header, footer { flex-shrink: 0; padding: .65rem 1rem; }
header h3 { font-weight: 600; } header p { margin-top: .25rem; max-height: 3.5rem; overflow-y: auto; }
.fields { min-height: 0; overflow-y: auto; padding: .5rem 1rem; display: flex; flex-direction: column; gap: .75rem; }
.fields label { display: block; } .fields select, .fields input[type=text] { width: 100%; border-radius: .35rem; padding: .45rem .6rem; background: #303030; }
.fields label.option { display: flex; gap: .5rem; align-items: center; } .description { color: #a3a3a3; font-size: .75rem; }.error { color: #fca5a5; }
footer { display: flex; flex-wrap: wrap; gap: .5rem; border-top: 1px solid rgb(255 255 255 / .08); } button { padding: .4rem .75rem; border-radius: .35rem; background: #404040; } button.accept { background: #2563eb; color: white; } button:disabled { opacity: .5; }
</style>
