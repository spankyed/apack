<template>
  <section class="plan-panel" aria-label="Claude Code plan review" data-testid="native-plan-panel">
    <header><span class="eyebrow">{{ entering ? 'Permission needed' : 'Ready to implement' }}</span><h2>{{ entering ? 'Enter plan mode' : 'Review plan' }}</h2></header>
    <div class="body" tabindex="0" aria-label="Plan details">
      <p v-if="entering" class="muted">Claude wants to explore the codebase and design an approach before making changes.</p>
      <p v-else-if="presentation.empty" class="muted">Claude wants to exit plan mode. No plan was provided.</p>
      <p v-else-if="presentation.withheld" role="note" data-testid="native-plan-withheld">The plan cannot be shown in full. Approval is withheld; ask Claude for a shorter, reviewable plan.</p>
      <template v-else>
        <div class="review-toolbar"><span>{{ editing ? 'Editing proposed plan' : 'Proposed plan' }}</span><button type="button" :disabled="disabled" @click="editing = !editing">{{ editing ? 'Preview' : 'Edit plan' }}</button></div>
        <textarea v-if="editing" v-model="draft" aria-label="Edit proposed plan" maxlength="200000" :disabled="disabled" class="plan-editor" />
        <div v-else data-testid="native-plan-preview"><TiptapEditor mode="viewer" variant="chat" :model-value="draft" /></div>
      </template>
      <p v-if="presentation.planFilePath" class="path">{{ presentation.planFilePath }}</p>
      <p v-if="reason" class="muted">{{ reason }}</p>
      <fieldset v-if="presentation.choices.length" class="choices">
        <legend>{{ entering ? 'Continue with' : 'Context and permissions' }}</legend>
        <p v-if="review.choiceWithdrawn" role="status" class="muted">That option is no longer available. Choose how to continue.</p>
        <label v-for="option in presentation.choices" :key="option.value">
          <input v-model="selected" type="radio" name="native-plan-choice" :value="option.value" :disabled="disabled" />
          <span>{{ option.label }}</span>
        </label>
      </fieldset>
      <label v-if="!entering" class="feedback"><span>Feedback for Claude</span><textarea v-model="feedback" aria-label="Plan feedback" maxlength="4000" rows="2" :disabled="disabled" placeholder="Tell Claude what to change, or add a note to your approval" /></label>
    </div>
    <footer><button type="button" class="quiet" :disabled="disabled" @click="emit('pause', pauseScope)">{{ cancelLabel ?? 'Cancel' }}</button><div class="decisions"><button type="button" class="secondary" :disabled="disabled" @click="$emit('respond', { approved: false, reason: feedback.trim() || undefined })">{{ entering ? 'Decline' : 'Keep planning' }}</button><button v-if="presentation.choices.length" type="button" class="primary" :disabled="disabled || !selectedChoice" @click="approve">{{ entering ? 'Enter plan mode' : 'Approve plan' }}</button></div></footer>
  </section>
</template>
<script lang="ts">
import type { ClaudePlanPresentation as PlanPresentation } from '#features/code/common/native-plan.ts'
export interface ClaudePlanReviewDraft {
  original: { plan: string; path?: string; empty: boolean; withheld: boolean }
  draft: string
  feedback: string
  editing: boolean
  choice?: PlanPresentation['choices'][number]
  choiceWithdrawn: boolean
}
</script>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import type { ClaudeDecisionPauseScope } from '#features/code/common/native-decision-pause.ts'
import type { ClaudePlanPresentation } from '#features/code/common/native-plan.ts'
const props = defineProps<{ entering: boolean; pauseScope?: ClaudeDecisionPauseScope; cancelLabel?: string; presentation: ClaudePlanPresentation; reason?: string; disabled: boolean }>()
const emit = defineEmits<{ respond: [response: { approved: boolean; choice?: string; reason?: string; plan?: string }]; pause: [scope?: ClaudeDecisionPauseScope] }>()
const sharedReview = defineModel<ClaudePlanReviewDraft>('review')
const original = (presentation: ClaudePlanPresentation) => ({
  plan: presentation.plan, path: presentation.planFilePath, empty: presentation.empty, withheld: presentation.withheld,
})
const initial = (presentation: ClaudePlanPresentation): ClaudePlanReviewDraft => ({
  original: original(presentation),
  draft: presentation.plan,
  feedback: '',
  editing: false,
  choice: presentation.choices.find(choice => choice.value === presentation.initialChoice),
  choiceWithdrawn: false,
})
const review = ref(sharedReview.value ?? initial(props.presentation))
function updateReview(changes: Partial<ClaudePlanReviewDraft>) {
  const next = { ...review.value, ...changes }
  review.value = next
  sharedReview.value = next
}

const draft = computed({ get: () => review.value.draft, set: draft => updateReview({ draft }) })
const feedback = computed({ get: () => review.value.feedback, set: feedback => updateReview({ feedback }) })
const editing = computed({ get: () => review.value.editing, set: editing => updateReview({ editing }) })
const selectedChoice = computed(() => {
  const selected = review.value.choice
  return props.presentation.choices.find(choice => selected && choice.value === selected.value
    && choice.mode === selected.mode && choice.clearContext === selected.clearContext)
})
const selected = computed({
  get: () => selectedChoice.value?.value ?? '',
  set: value => updateReview({ choice: props.presentation.choices.find(choice => choice.value === value), choiceWithdrawn: false }),
})

watch(() => props.presentation, current => {
  const source = original(current), previous = review.value.original
  if (source.plan !== previous.plan || source.path !== previous.path
    || source.empty !== previous.empty || source.withheld !== previous.withheld) {
    updateReview(initial(current))
  } else if (review.value.choice && !selectedChoice.value) {
    updateReview({ choice: undefined, choiceWithdrawn: true })
  }
}, { immediate: true })

function approve() {
  const choice = selectedChoice.value
  if (props.disabled || !choice) return
  emit('respond', {
    approved: true,
    choice: choice.value,
    reason: feedback.value.trim() || undefined,
    ...(!props.entering && !props.presentation.empty && draft.value !== props.presentation.plan ? { plan: draft.value } : {}),
  })
}
</script>
<style scoped>
.plan-panel { display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; border:1px solid rgb(255 255 255 / .1); border-radius:12px; background:#232323; color:#e5e5e5; }
header { display:flex; flex:none; align-items:center; justify-content:space-between; gap:12px; padding:10px 16px; }
h2 { margin:0; font-size:14px; font-weight:600; }.eyebrow { font-size:10px; color:#b8a887; text-transform:uppercase; letter-spacing:.08em; }
.body { flex:1; min-height:0; overflow-y:auto; padding:0 16px 12px; font-size:12px; line-height:1.5; }.muted,.path { color:#aaa; }.path { overflow-wrap:anywhere; font-size:11px; }
.review-toolbar { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; color:#aaa; }.review-toolbar button { padding:4px 8px; background:#333; }
.choices { margin:12px 0; padding:8px 10px; border:1px solid #444; border-radius:8px; }.choices legend { padding:0 4px; color:#aaa; }.choices label { display:flex; align-items:flex-start; gap:8px; padding:5px 0; }.choices input { margin-top:3px; accent-color:#c4b5fd; }
.feedback { display:block; color:#aaa; }textarea { display:block; box-sizing:border-box; width:100%; margin-top:6px; padding:8px 10px; border:1px solid #555; border-radius:6px; background:#191919; color:#eee; resize:vertical; }.plan-editor { min-height:180px; font-family:monospace; }
footer { flex:none; display:flex; align-items:center; justify-content:space-between; gap:8px; border-top:1px solid rgb(255 255 255 / .07); padding:8px 12px; }.decisions { display:flex; gap:8px; }button { border-radius:6px; padding:7px 12px; font-size:12px; font-weight:500; cursor:pointer; }.primary { background:#e5e5e5; color:#202020; }.secondary { background:#3b3b3b; color:#eee; }.quiet { color:#aaa; background:transparent; }button:disabled { opacity:.5; cursor:default; }button:focus-visible,input:focus-visible,textarea:focus-visible { outline:2px solid #93c5fd; outline-offset:2px; }
</style>
