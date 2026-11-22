<template>
  <section class="native-question-panel" aria-label="Claude Code questions" data-testid="native-question-panel">
    <header><span>Question {{ step + 1 }} of {{ parsed?.questions.length ?? '?' }}</span><strong>{{ parsed?.title || current?.header || 'Claude Code' }}</strong></header>
    <div v-if="!parsed || !current" class="body">This question format needs the native interface. Use “Use native interface” above to continue.</div>
    <div v-else class="body" :key="step" tabindex="0" role="group" aria-label="Question details" :aria-busy="pending || readingImages || undefined" @paste="pasteImages">
      <p v-if="displayError" role="alert" class="problem">{{ displayError }}</p>
      <h2>{{ current.question }}</h2>
      <p v-if="current.description" class="muted">{{ current.description }}</p>
      <template v-if="isChoice">
        <label v-for="option in current.options" :key="option.label" class="option" :class="{ selected: state.selected.includes(option.label) }">
          <input :type="current.multiSelect ? 'checkbox' : 'radio'" :name="questionId" :value="option.label" :checked="state.selected.includes(option.label)" :disabled="disabled" @change="choose(option.label)" />
          <span><strong>{{ option.label }}</strong><small v-if="option.description">{{ option.description }}</small></span>
        </label>
        <button v-if="!state.customOpen" type="button" class="custom-answer" :disabled="disabled" @click="openCustomAnswer">Write your own answer</button>
      </template>
      <label v-if="!isChoice || state.customOpen" class="answer">
        <span>{{ current.kind === 'number' ? current.unit ? `Value (${current.unit})` : 'Value' : 'Your answer' }}</span>
        <input v-if="current.kind === 'number'" ref="numberInput" type="number" :value="state.custom" :min="current.min" :max="current.max" :step="current.step ?? 'any'" :disabled="disabled" @input="setNumber" />
        <textarea v-else ref="customInput" v-model="state.custom" :placeholder="current.placeholder" rows="2" :disabled="disabled" maxlength="32768" @input="markStarted(); state.selected = []" />
      </label>
      <div v-if="state.customOpen || state.images.length" class="question-images">
        <label class="attach-image">
          <span>Attach image</span>
          <input type="file" :accept="CLAUDE_QUESTION_IMAGE_TYPES.join(',')" multiple :disabled="disabled" @change="pickImages" />
        </label>
        <ul v-if="state.images.length" aria-label="Question images">
          <li v-for="image in state.images" :key="image.id">
            <img :src="`data:${image.mediaType};base64,${image.data}`" alt="" />
            <span>{{ image.name }}</span>
            <button type="button" :aria-label="`Remove ${image.name}`" :disabled="disabled" @click="state.images = state.images.filter(item => item !== image)">Remove</button>
          </li>
        </ul>
      </div>
      <p v-if="imageProblem" class="problem" role="alert">{{ imageProblem }}</p>
      <template v-if="selectedPreview">
        <p class="muted">Option preview</p>
        <NativeQuestionHtmlPreview v-if="viewPresentation?.previewFormat === 'html'" :fragment="selectedPreview" />
        <div v-else-if="viewPresentation?.previewFormat === 'markdown'" data-testid="native-question-preview"><TiptapEditor mode="viewer" variant="chat" :model-value="selectedPreview" /></div>
        <pre v-else data-testid="native-question-preview">{{ selectedPreview }}</pre>
      </template>
      <p v-if="previewWithheld" class="muted" data-testid="native-question-preview-withheld">Preview cannot be shown in full. Compare the option labels and descriptions.</p>
      <details><summary>Add notes</summary><textarea v-model="state.notes" @input="markStarted" aria-label="Notes for this question" rows="2" :disabled="disabled" maxlength="8192" /></details>
      <details v-if="step + 1 === parsed.questions.length"><summary>Add a general response</summary><textarea v-model="generalResponse" @input="markStarted" aria-label="General response" rows="2" :disabled="disabled" maxlength="32768" /></details>
    </div>
    <p v-if="props.presentation?.notice" class="native-tool-notice" role="note">{{ props.presentation.notice }}</p>
    <footer>
      <div class="decision-status">
        <button type="button" class="quiet" :disabled="disabled" @click="$emit('pause')">{{ cancelLabel ?? 'Cancel' }}</button>
        <button v-if="canClarify && current && parsed?.questions.every(question => !question.kind || question.kind === 'choice')" type="button" class="quiet" :disabled="disabled || hasUnsupportedClarificationDraft" :title="hasUnsupportedClarificationDraft ? 'Submit answers to include your general response or notes.' : undefined" @click="submit(false, 'clarify')">Chat about this</button>
        <span v-if="pending" role="status" class="muted">Waiting for Claude…</span>
      </div>
      <div class="navigation">
        <button v-if="canReject" type="button" :disabled="disabled" @click="emit('reject')">Reject question</button>
        <button v-if="step > 0" type="button" :disabled="disabled" @click="step--">Back</button>
        <button v-if="parsed && current" type="button" :disabled="disabled" @click="skip">Skip</button>
        <button v-if="parsed && step + 1 === parsed.questions.length && parsed.questions.every(question => typeof question.kind === 'string')" type="button" :disabled="disabled" @click="submit(true)">Ask again</button>
        <button v-if="parsed && current" type="button" class="primary" :disabled="disabled" @click="advance">{{ step + 1 === parsed.questions.length ? 'Submit answers' : 'Next' }}</button>
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, shallowRef, useId, watch } from 'vue'
import { describeClaudeUiProblem } from '#features/code/common/native-ui-problem.ts'
import NativeQuestionHtmlPreview from './NativeQuestionHtmlPreview.vue'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import { CLAUDE_QUESTION_IMAGE_BYTES, CLAUDE_QUESTION_IMAGE_COUNT, CLAUDE_QUESTION_IMAGE_TYPES, ClaudeQuestionCardSchema, type ClaudeQuestionAnswer, type ClaudeQuestionImage, type ClaudeQuestionPresentation } from '#features/code/common/native-question.ts'
const props = defineProps<{ card: Record<string, unknown>; cancelLabel?: string; canReject?: boolean; canClarify?: boolean; disabled: boolean; pending?: boolean; error?: string; presentation?: ClaudeQuestionPresentation; renderToken?: string }>()
const imageProblem = ref(''), readingImages = ref(false)
const disabled = computed(() => props.disabled || props.pending === true || readingImages.value)
const displayError = computed(() => describeClaudeUiProblem(props.error, 'decision'))
const emit = defineEmits<{ respond: [answer: ClaudeQuestionAnswer, decision?: 'clarify', images?: ClaudeQuestionImage[]]; started: [token?: string]; pause: []; reject: [] }>()
const answering = ref(false), acceptedCard = shallowRef(props.card), acceptedPresentation = shallowRef(props.presentation), acceptedToken = ref(props.renderToken)
watch(() => [JSON.stringify(props.card), props.presentation, props.renderToken], () => {
  if (!answering.value) { acceptedCard.value = props.card; acceptedPresentation.value = props.presentation; acceptedToken.value = props.renderToken }
})
const viewPresentation = computed(() => acceptedPresentation.value)
const parsed = computed(() => { const value = ClaudeQuestionCardSchema.safeParse(acceptedCard.value); return value.success ? value.data : undefined })
function markStarted() { if (!answering.value) { answering.value = true; emit('started', acceptedToken.value) } }
const generalResponse = ref('')
const step = ref(0), numberInput = ref<HTMLInputElement>(), customInput = ref<HTMLTextAreaElement>()
const questionId = useId()
type DraftImage = ClaudeQuestionImage & { id: string; name: string; size: number }
const drafts = reactive<{ selected: string[]; custom: string; customOpen: boolean; notes: string; images: DraftImage[] }[]>([])
watch(() => JSON.stringify(acceptedCard.value), () => { const card = parsed.value; generalResponse.value = ''; step.value = 0; drafts.splice(0, drafts.length, ...(card?.questions.map(question => ({ selected: [], custom: question.kind === 'number' && question.defaultValue !== undefined ? String(question.defaultValue) : '', customOpen: false, notes: '', images: [] })) ?? [])) }, { immediate: true })
const current = computed(() => parsed.value?.questions[step.value])
const state = computed(() => drafts[step.value] ?? { selected: [], custom: '', customOpen: false, notes: '', images: [] })
const isChoice = computed(() => !current.value?.kind || current.value.kind === 'choice')
const hasUnsupportedClarificationDraft = computed(() => !!generalResponse.value.trim() || !!parsed.value?.questions.some((question, index) =>
  drafts[index]?.notes.trim() && (question.multiSelect || !(viewPresentation.value
    ? viewPresentation.value.previews.some(preview => preview.question === question.question && preview.kind !== 'empty')
    : question.options.some(option => option.preview?.trim())))
))
async function openCustomAnswer() {
  if (disabled.value || !isChoice.value) return
  const draft = state.value
  draft.customOpen = true
  await nextTick()
  if (state.value === draft && !disabled.value) customInput.value?.focus()
}
async function addImages(files: File[]) {
  if (disabled.value || !current.value || !files.length) return
  const draft = state.value, held = drafts.flatMap(item => item.images)
  const sizes = files.reduce((size, file) => size + file.size, held.reduce((size, image) => size + image.size, 0))
  const types: readonly string[] = CLAUDE_QUESTION_IMAGE_TYPES
  imageProblem.value = ''
  if (files.some(file => !file.size || !types.includes(file.type))) {
    imageProblem.value = 'Choose a PNG, JPEG, GIF, or WebP image.'
    return
  }
  if (held.length + files.length > CLAUDE_QUESTION_IMAGE_COUNT || sizes > CLAUDE_QUESTION_IMAGE_BYTES) {
    imageProblem.value = 'Use up to four images totaling at most 10 MB.'
    return
  }
  markStarted()
  readingImages.value = true
  try {
    const images = await Promise.all(files.map(file => new Promise<DraftImage>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result !== 'string' || !reader.result.includes(';base64,')) return reject(new Error('Image encoding failed'))
        resolve({ id: crypto.randomUUID(), name: file.name || 'Pasted image', size: file.size,
          mediaType: file.type as ClaudeQuestionImage['mediaType'], data: reader.result.split(';base64,')[1] })
      }
      reader.onerror = reader.onabort = reject
      reader.readAsDataURL(file)
    })))
    if (state.value === draft) draft.images.push(...images)
  } catch {
    imageProblem.value = 'This image could not be read.'
  } finally {
    readingImages.value = false
  }
}
function pickImages(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  void addImages(files)
}
function pasteImages(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith('image/'))
  if (!files.length) return
  event.preventDefault()
  void addImages(files)
}
function previewFor(question: string, option: string, original?: string) {
  if (!viewPresentation.value) return original
  const preview = viewPresentation.value.previews.find(item => item.question === question && item.option === option)
  return preview?.kind === 'full' ? viewPresentation.value.previewFormat === 'html' ? preview.html : preview.markdown : undefined
}
const selectedOption = computed(() => current.value?.options.find(option => state.value.selected.includes(option.label) && option.preview))
const selectedPreview = computed(() => current.value && selectedOption.value ? previewFor(current.value.question, selectedOption.value.label, selectedOption.value.preview) : undefined)
const previewWithheld = computed(() => current.value && selectedOption.value && viewPresentation.value?.previews.some(item => item.question === current.value!.question && item.option === selectedOption.value!.label && item.kind === 'withheld'))
function choose(label: string) {
  if (disabled.value || !current.value) return
  markStarted()
  const draft = state.value
  draft.custom = ''; draft.customOpen = false
  draft.selected = current.value.multiSelect ? draft.selected.includes(label) ? draft.selected.filter(value => value !== label) : [...draft.selected, label] : [label]
}
function setNumber(event: Event) { markStarted(); state.value.custom = (event.target as HTMLInputElement).value; state.value.selected = [] }
function submit(followUp = false, decision?: 'clarify') {
  if (!parsed.value || disabled.value || decision === 'clarify' && hasUnsupportedClarificationDraft.value) return
  markStarted()
  const answers: NonNullable<ClaudeQuestionAnswer['answers']> = Object.create(null)
  const annotations: NonNullable<ClaudeQuestionAnswer['annotations']> = Object.create(null)
  parsed.value.questions.forEach((question, index) => {
    const draft = drafts[index]
    if (draft.custom.trim()) answers[question.question] = draft.custom.trim()
    else if (draft.selected.length) answers[question.question] = question.multiSelect ? [...draft.selected] : draft.selected[0]
    const selected = question.options.find(option => draft.selected.includes(option.label) && option.preview)
    const preview = selected && previewFor(question.question, selected.label, selected.preview) ? selected.preview : undefined
    if (preview || draft.notes.trim()) annotations[question.question] = { ...(preview ? { preview } : {}), ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}) }
  })
  const answer = { answers, annotations, ...(generalResponse.value.trim() ? { response: generalResponse.value.trim() } : {}), ...(followUp ? { followUp: true } : {}) }
  const images = drafts.flatMap(draft => draft.images.map(({ mediaType, data }) => ({ mediaType, data })))
  if (images.length) emit('respond', answer, decision, images)
  else if (decision) emit('respond', answer, decision)
  else emit('respond', answer)
}
function advance() {
  if (disabled.value || !parsed.value || numberInput.value && !numberInput.value.reportValidity()) return
  markStarted()
  if (step.value + 1 < parsed.value.questions.length) step.value++
  else submit()
}
function skip() {
  if (disabled.value || !parsed.value) return
  state.value.selected = []; state.value.custom = ''; state.value.customOpen = false; state.value.notes = ''
  markStarted()
  if (step.value + 1 < parsed.value.questions.length) step.value++
  else submit()
}
</script>

<style scoped>
.native-question-panel { flex:1; display:flex; flex-direction:column; min-height:0; height:100%; overflow:hidden; border:1px solid rgb(255 255 255 / .1); border-radius:12px; background:#232323; color:#e5e5e5; }
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
.decision-status { display:flex; flex-wrap:wrap; align-items:center; gap:4px 8px; min-width:0; }
.decision-status [role=status] { white-space:nowrap; }
.problem { margin:0 0 12px; padding:8px 10px; border:1px solid #555; border-radius:6px; }
.navigation { display:flex; gap:6px; } button { border-radius:6px; padding:7px 10px; font-size:12px; background:#3b3b3b; cursor:pointer; }
.custom-answer { margin:2px 0 0; padding:6px 10px; border:1px solid #454545; background:#292929; color:#ddd; }
.custom-answer:hover:enabled { background:#333; }
.question-images { margin:8px 0; }
.attach-image { display:inline-flex; position:relative; padding:5px 10px; border:1px solid #555; border-radius:6px; }
.attach-image input { position:absolute; width:100%; height:100%; inset:0; opacity:0; cursor:pointer; }
.attach-image:focus-within { outline:2px solid #93c5fd; outline-offset:2px; }
.question-images ul { display:flex; flex-wrap:wrap; gap:6px; padding:0; margin:6px 0 0; }
.question-images li { display:flex; align-items:center; gap:6px; max-width:100%; padding:4px; background:#303030; border-radius:6px; }
.question-images li img { width:28px; height:28px; object-fit:contain; }
.question-images li span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.question-images li button { padding:4px 6px; }
button.primary { background:#e5e5e5; color:#202020; } button.quiet { background:transparent; color:#aaa; } button:disabled { opacity:.5; cursor:default; }
button:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible { outline:2px solid #93c5fd; outline-offset:2px; }
.native-tool-notice { flex:none; max-height:6rem; overflow:auto; overflow-wrap:anywhere; margin:0; padding:8px 12px; color:#aaa; font-size:11px; }
</style>
