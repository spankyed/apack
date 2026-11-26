<template>
  <section ref="panel" class="publish-review" role="dialog" :aria-labelledby="headingId" data-native-notice="permission_publish_plugin" @keydown.esc.stop.prevent="escape">
    <h3 :id="headingId">{{ showFiles ? 'Files in the plugin folder' : notice.title }}</h3>
    <div v-if="showFiles" ref="fileList" class="publish-review__reading" aria-label="Full file list" tabindex="0">
      <ul>
        <li v-for="(file, index) in notice.files" :key="index">{{ file }}</li>
      </ul>
    </div>
    <div v-else class="publish-review__reading" tabindex="0">
      <p v-for="(paragraph, index) in notice.paragraphs" :key="index">{{ paragraph }}</p>
      <ul v-if="notice.previewFiles.length" aria-label="Files in the summary">
        <li v-for="(file, index) in notice.previewFiles" :key="index">{{ file }}</li>
      </ul>
    </div>
    <p v-if="problem" class="publish-review__problem" role="alert">{{ problem }}</p>
    <footer v-if="showFiles">
      <button type="button" @click="toggleFiles(false)">Back to review</button>
    </footer>
    <footer v-else>
      <button v-if="notice.files.length" ref="openList" type="button" class="publish-review__list" :disabled="pending" @click="toggleFiles(true)">See every file</button>
      <button v-if="confirmChoice" type="button" :disabled="pending" @click="emit('answer', confirmChoice.value)">{{ confirmChoice.label }}</button>
      <button ref="decline" type="button" :disabled="pending" @click="emit('answer', 'publish_plugin_decline')">{{ declineChoice.label }}</button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import type { ClaudeNativeNotice } from '#features/code/common/native-notice.ts'

const props = defineProps<{ notice: Extract<ClaudeNativeNotice, { kind: 'permission_publish_plugin' }>; pending?: boolean; problem?: string }>()
const emit = defineEmits<{ answer: [decision: 'publish_plugin_confirm' | 'publish_plugin_decline'] }>()
const headingId = useId()
const showFiles = ref(false)
const panel = ref<HTMLElement>()
const decline = ref<HTMLButtonElement>()
const openList = ref<HTMLButtonElement>()
const fileList = ref<HTMLElement>()
const confirmChoice = computed(() => props.notice.choices.length === 2 ? props.notice.choices[0] : undefined)
const declineChoice = computed(() => props.notice.choices.at(-1)!)

let previousFocus: HTMLElement | undefined
onMounted(() => {
  if (!document.hasFocus()) return
  if (document.activeElement instanceof HTMLElement) previousFocus = document.activeElement
  decline.value?.focus()
})
onBeforeUnmount(() => {
  if (!panel.value?.contains(document.activeElement)) return
  void nextTick(() => {
    if (document.hasFocus() && document.activeElement === document.body && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  })
})

async function toggleFiles(open: boolean) {
  showFiles.value = open
  await nextTick()
  if (open) fileList.value?.focus()
  else openList.value?.focus()
}

function escape() {
  if (showFiles.value) void toggleFiles(false)
  else if (!props.pending) emit('answer', 'publish_plugin_decline')
}
</script>

<style scoped>
.publish-review { flex-shrink: 0; margin: 8px 16px; padding: 12px; border: 1px solid #ffffff16; border-radius: 10px; background: #202022; color: #ddd9d4; font-size: 12px; }
h3 { margin: 0 0 8px; color: #eee; font-size: 13px; overflow-wrap: anywhere; }
.publish-review__reading { max-height: min(18rem, 27vh); overflow: auto; overscroll-behavior: contain; overflow-wrap: anywhere; }
p, li { white-space: pre-wrap; line-height: 1.5; }
p { margin: 0 0 7px; }
ul { margin: 6px 0 0; padding-inline-start: 18px; }
footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 8px; }
button { max-width: 100%; min-height: 32px; padding: 5px 10px; border: 1px solid #ffffff26; border-radius: 7px; overflow-wrap: anywhere; }
button:hover { background: #ffffff0e; }
button:focus-visible, .publish-review__reading:focus-visible { outline: 2px solid #d3aa8e; outline-offset: 2px; }
button:disabled { opacity: .4; }
.publish-review__list { margin-inline-end: auto; }
.publish-review__problem { color: #fca5a5; }
</style>
