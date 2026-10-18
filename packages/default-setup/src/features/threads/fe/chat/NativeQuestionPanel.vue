<template>
  <section class="native-question-panel" aria-label="Claude Code questions" data-testid="native-question-panel">
    <header><span>Question {{ step + 1 }} of {{ parsed?.questions.length ?? '?' }}</span><strong>{{ parsed?.title || current?.header || 'Claude Code' }}</strong></header>
    <div v-if="!parsed || !current" class="body">This question format needs the native interface. Use “Use native interface” above to continue.</div>
    <div v-else class="body" :key="step" tabindex="0" aria-label="Question details">
      <p v-if="error" role="alert">{{ error }}</p>
      <h2>{{ current.question }}</h2>
      <p v-if="current.description" class="muted">{{ current.description }}</p>
      <template v-if="!current.kind || current.kind === 'choice'">
        <label v-for="option in current.options" :key="option.label" class="option" :class="{ selected: state.selected.includes(option.label) }">
          <input :type="current.multiSelect ? 'checkbox' : 'radio'" :name="`native-question-${step}`" :value="option.label" :checked="state.selected.includes(option.label)" :disabled="disabled" @change="choose(option.label)" />
          <span><strong>{{ option.label }}</strong><small v-if="option.description">{{ option.description }}</small></span>
        </label>
        <template v-if="selectedPreview">
          <p class="muted">Option preview</p>
          <div v-if="presentation?.previewFormat === 'markdown'" data-testid="native-question-preview"><TiptapEditor mode="viewer" variant="chat" :model-value="selectedPreview" /></div>
          <pre v-else data-testid="native-question-preview">{{ selectedPreview }}</pre>
        </template>
      </template>
      <p v-if="previewWithheld" class="muted" data-testid="native-question-preview-withheld">Preview cannot be shown in full. Compare the option labels and descriptions.</p>
      <label class="answer">
        <span>{{ current.kind === 'number' ? current.unit ? `Value (${current.unit})` : 'Value' : current.kind === 'text' ? 'Your answer' : 'Or write your own answer' }}</span>
        <input v-if="current.kind === 'number'" ref="numberInput" type="number" :value="state.custom" :min="current.min" :max="current.max" :step="current.step ?? 'any'" :disabled="disabled" @input="setNumber" />
        <textarea v-else v-model="state.custom" :placeholder="current.placeholder" rows="2" :disabled="disabled" maxlength="32768" @input="state.selected = []" />
      </label>
      <details><summary>Add notes</summary><textarea v-model="state.notes" aria-label="Notes for this question" rows="2" :disabled="disabled" maxlength="8192" /></details>
      <details v-if="step + 1 === parsed.questions.length"><summary>Add a general response</summary><textarea v-model="generalResponse" aria-label="General response" rows="2" :disabled="disabled" maxlength="32768" /></details>
    </div>
    <footer>
      <button type="button" class="quiet" :disabled="disabled" @click="$emit('pause')">Cancel</button>
      <div class="navigation">
        <button v-if="step > 0" type="button" :disabled="disabled" @click="step--">Back</button>
        <button v-if="parsed && current" type="button" :disabled="disabled" @click="skip">Skip</button>
        <button v-if="parsed && step + 1 === parsed.questions.length && parsed.questions.every(question => typeof question.kind === 'string')" type="button" :disabled="disabled" @click="submit(true)">Ask again</button>
        <button v-if="parsed && current" type="button" class="primary" :disabled="disabled" @click="advance">{{ step + 1 === parsed.questions.length ? 'Submit answers' : 'Next' }}</button>
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import { ClaudeQuestionCardSchema, type ClaudeQuestionAnswer, type ClaudeQuestionPresentation } from '#features/code/common/native-question.ts'
const props = defineProps<{ card: Record<string, unknown>; disabled: boolean; error?: string; presentation?: ClaudeQuestionPresentation }>()
const emit = defineEmits<{ respond: [answer: ClaudeQuestionAnswer]; pause: [] }>()
const parsed = computed(() => { const value = ClaudeQuestionCardSchema.safeParse(props.card); return value.success ? value.data : undefined })
const generalResponse = ref('')
const step = ref(0), numberInput = ref<HTMLInputElement>()
const drafts = reactive<{ selected: string[]; custom: string; notes: string }[]>([])
watch(() => JSON.stringify(props.card), () => { const card = parsed.value; generalResponse.value = ''; step.value = 0; drafts.splice(0, drafts.length, ...(card?.questions.map(question => ({ selected: [], custom: question.kind === 'number' && question.defaultValue !== undefined ? String(question.defaultValue) : '', notes: '' })) ?? [])) }, { immediate: true })
const current = computed(() => parsed.value?.questions[step.value])
const state = computed(() => drafts[step.value] ?? { selected: [], custom: '', notes: '' })
function previewFor(question: string, option: string, original?: string) {
  if (!props.presentation) return original
  const preview = props.presentation.previews.find(item => item.question === question && item.option === option)
  return preview?.kind === 'full' ? preview.markdown : undefined
}
const selectedOption = computed(() => current.value?.options.find(option => state.value.selected.includes(option.label) && option.preview))
const selectedPreview = computed(() => current.value && selectedOption.value ? previewFor(current.value.question, selectedOption.value.label, selectedOption.value.preview) : undefined)
const previewWithheld = computed(() => current.value && selectedOption.value && props.presentation?.previews.some(item => item.question === current.value!.question && item.option === selectedOption.value!.label && item.kind === 'withheld'))
function choose(label: string) {
  if (props.disabled || !current.value) return
  const draft = state.value
  draft.custom = ''
  draft.selected = current.value.multiSelect ? draft.selected.includes(label) ? draft.selected.filter(value => value !== label) : [...draft.selected, label] : [label]
}
function setNumber(event: Event) { state.value.custom = (event.target as HTMLInputElement).value; state.value.selected = [] }
function submit(followUp = false) {
  if (!parsed.value || props.disabled) return
  const answers: NonNullable<ClaudeQuestionAnswer['answers']> = {}, annotations: NonNullable<ClaudeQuestionAnswer['annotations']> = {}
  parsed.value.questions.forEach((question, index) => {
    const draft = drafts[index]
    if (draft.custom.trim()) answers[question.question] = draft.custom.trim()
    else if (draft.selected.length) answers[question.question] = question.multiSelect ? [...draft.selected] : draft.selected[0]
    const selected = question.options.find(option => draft.selected.includes(option.label) && option.preview)
    const preview = selected && previewFor(question.question, selected.label, selected.preview) ? selected.preview : undefined
    if (preview || draft.notes.trim()) annotations[question.question] = { ...(preview ? { preview } : {}), ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}) }
  })
  emit('respond', { answers, annotations, ...(generalResponse.value.trim() ? { response: generalResponse.value.trim() } : {}), ...(followUp ? { followUp: true } : {}) })
}
function advance() {
  if (props.disabled || !parsed.value || numberInput.value && !numberInput.value.reportValidity()) return
  if (step.value + 1 < parsed.value.questions.length) step.value++
  else submit()
}
function skip() {
  if (props.disabled || !parsed.value) return
  state.value.selected = []; state.value.custom = ''; state.value.notes = ''
  if (step.value + 1 < parsed.value.questions.length) step.value++
  else submit()
}
</script>

<style scoped>
.native-question-panel { display:flex; flex-direction:column; min-height:0; height:100%; overflow:hidden; border:1px solid rgb(255 255 255 / .1); border-radius:12px; background:#232323; color:#e5e5e5; }
header { display:flex; align-items:center; justify-content:space-between; gap:12px; flex:none; padding:10px 16px; font-size:12px; }
header span { color:#b8a887; font-size:10px; text-transform:uppercase; letter-spacing:.06em; white-space:nowrap; }
header strong { overflow-wrap:anywhere; max-height:3em; overflow-y:auto; }
.body { flex:1; min-height:0; overflow-y:auto; padding:0 16px 12px; font-size:12px; line-height:1.5; }
h2 { font-size:14px; margin:0 0 12px; font-weight:500; overflow-wrap:anywhere; }
.muted, .answer span, summary { color:#aaa; font-size:11px; }
.option { display:flex; gap:10px; align-items:flex-start; padding:9px 10px; margin:6px 0; border:1px solid #444; border-radius:7px; cursor:pointer; }
.option.selected { border-color:#aaa; background:#303030; }
.option input { margin-top:3px; flex:none; accent-color:#ddd; }
.option strong { font-weight:500; } small { display:block; color:#aaa; font-size:11px; }
.answer { display:block; margin-top:12px; } .answer span { display:block; margin-bottom:4px; }
textarea, input[type=number] { width:100%; padding:7px 9px; border:1px solid #555; border-radius:6px; background:#191919; color:#eee; font-size:12px; }
textarea { resize:vertical; } details { margin-top:10px; } summary { cursor:pointer; margin-bottom:5px; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; padding:8px; background:#191919; border-radius:6px; font-size:11px; }
footer { display:flex; flex:none; justify-content:space-between; align-items:center; gap:8px; padding:8px 12px; border-top:1px solid rgb(255 255 255 / .07); }
.navigation { display:flex; gap:6px; } button { border-radius:6px; padding:7px 10px; font-size:12px; background:#3b3b3b; cursor:pointer; }
button.primary { background:#e5e5e5; color:#202020; } button.quiet { background:transparent; color:#aaa; } button:disabled { opacity:.5; cursor:default; }
button:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible { outline:2px solid #93c5fd; outline-offset:2px; }
</style>
