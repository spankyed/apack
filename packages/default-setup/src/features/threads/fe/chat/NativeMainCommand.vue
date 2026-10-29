<template>
  <NativeBackgroundReview v-if="state?.status === 'panel' && state.panel?.commandName === 'background'" :key="state.panel.id" :panel-id="state.panel.id" :state="state.backgroundReview" @answer="emit('background', $event)" />
  <NativeHelpPanel v-else-if="state?.status === 'panel' && state.panel?.commandName === 'help'" :key="state.panel.id" :state="state.settings" @operate="emit('settings', $event)" @close="emit('panel')" />
  <NativeSettingsPanel v-else-if="state?.status === 'panel' && state.panel && ['config','model','status','usage','theme'].includes(state.panel.commandName)" :key="state.panel.id" :subject="state.panel.commandName === 'model' ? 'model' : state.panel.commandName === 'theme' ? 'theme' : 'settings'" :state="state.settings" @operate="emit('settings', $event)" @close="emit('panel')" />
  <NativeCommandPanel v-else-if="state?.status === 'panel' && state.panel" :name="state.panel.commandName" :owner-id="ownerId" :output="output" @input="emit('panel', $event)" @close="emit('panel')" @resize="emit('resize', $event)" />
  <section v-else-if="state?.status === 'command_output' && state.output && !dismissed" aria-label="Native command output" class="mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.025]">
    <header class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
      <span class="text-xs text-neutral-400">/{{ state.output.commandName }}</span>
      <div class="flex gap-2"><button type="button" class="rounded-lg px-2 py-1 text-xs text-neutral-400 hover:bg-white/5 hover:text-neutral-200" @click="emit('expand', !expanded)">{{ expanded ? 'Show composer' : 'Expand output' }}</button><button type="button" class="rounded-lg px-2 py-1 text-xs text-neutral-400 hover:bg-white/5 hover:text-neutral-200" @click="emit('dismiss')">Back to messages</button></div>
    </header>
    <div role="region" aria-label="Command result" tabindex="0" class="min-h-0 flex-1 overflow-auto overscroll-contain p-3"><NativeTranscriptMessage v-if="frame" :frame="frame" @press="(id, href) => emit('press', id, href)" @field="emit('field', $event)" /><pre v-else :class="state.output.text.includes('\n') ? 'whitespace-pre' : 'whitespace-pre-wrap break-words'" class="text-xs leading-relaxed text-neutral-300">{{ state.output.text }}</pre></div>
  </section>
  <section v-else-if="state?.status === 'confirmation' || state?.status === 'deciding'" aria-label="Native command confirmation" class="mx-4 mb-3 shrink-0 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3">
    <p class="text-sm text-neutral-200 [overflow-wrap:anywhere]">{{ state.command?.title }}</p>
    <div class="mt-3 flex flex-wrap gap-2"><button ref="cancel" type="button" :disabled="state.status === 'deciding'" class="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-40" @click="emit('decide', 'cancel')">Cancel</button><button type="button" :disabled="state.status === 'deciding'" class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-40" @click="emit('decide', 'confirm')">{{ state.command?.confirmLabel }}</button></div>
  </section>
  <p v-else-if="state?.status === 'pending'" role="status" class="mx-4 mb-2 shrink-0 text-xs text-neutral-400">Running native command…</p>
</template>
<script setup lang="ts">
import NativeBackgroundReview from './NativeBackgroundReview.vue'
import { nextTick, ref, watch } from 'vue'
import type { ClaudeUiMountState } from '#features/code/be/services/claude-code/ui-presentation.ts'
import NativeTranscriptMessage from './NativeTranscriptMessage.vue'
import type { ClaudeUiTranscriptFrame, ClaudeUiFieldEvent } from '#features/code/be/services/claude-code/ui-presentation.ts'
import NativeCommandPanel from './NativeCommandPanel.vue'
import NativeSettingsPanel from './NativeSettingsPanel.vue'
import NativeHelpPanel from './NativeHelpPanel.vue'
const props = defineProps<{ state?: ClaudeUiMountState['agentInput']; frame?: ClaudeUiTranscriptFrame; ownerId: string; output: readonly { sequence: number; text: string }[]; dismissed: boolean; expanded: boolean }>()
const emit = defineEmits<{ background: [request: { panelId: string; revision: string; decision: 'confirm' | 'cancel' }]; settings: [action: import('#features/code/common/native-settings.ts').ClaudeSettingsOperation]; press: [id: string, href?: string]; field: [event: ClaudeUiFieldEvent]; panel: [text?: string]; resize: [size: { columns: number; rows: number }]; decide: [decision: 'confirm' | 'cancel']; dismiss: []; expand: [value: boolean] }>()
const cancel = ref<HTMLButtonElement>()
watch(() => props.state?.status, async status => { if (status === 'confirmation') { await nextTick(); cancel.value?.focus({ preventScroll: true }) } })
</script>
