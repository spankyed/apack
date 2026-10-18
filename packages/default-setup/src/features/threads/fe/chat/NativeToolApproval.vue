<template>
  <section class="native-tool-approval" :aria-label="`${toolName} approval`" :data-testid="`native-${toolName.toLowerCase()}-approval`">
    <header>
      <span class="eyebrow">Permission needed</span>
      <h2>{{ title }}</h2>
    </header>
    <div class="details" tabindex="0" :aria-label="`${toolName} request details`">
      <p class="question">{{ question }}</p>
      <code :data-testid="toolName === 'Bash' ? 'native-bash-command' : 'native-read-path'">{{ toolName === 'Bash' ? command : filePath }}</code>
      <section v-if="review" class="change-review" aria-label="Proposed file change" data-testid="native-file-review">
        <p v-if="review.withheld" role="note">{{ review.notice || 'Claude withheld the proposed change; it cannot be reviewed here.' }}</p>
        <template v-else>
          <p v-if="review.notice" role="note">{{ review.notice }}</p>
          <template v-if="review.before !== undefined"><p class="change-label">Before</p><code data-testid="native-file-before" class="before">{{ review.before }}</code></template>
          <p class="change-label">{{ review.before === undefined ? 'New file' : 'After' }}</p><code data-testid="native-file-after" class="after">{{ review.after }}</code>
          <p v-if="review.replaceAll" role="note">Replace all matching occurrences</p>
        </template>
      </section>
      <p v-if="cwd" class="reason">Working directory</p>
      <code v-if="cwd" data-testid="native-bash-cwd">{{ cwd }}</code>
      <p v-if="reason" class="reason">{{ reason }}</p>
      <details>
        <summary>Add a reason for denying</summary>
        <textarea v-model="feedback" aria-label="Reason for denying" rows="2" maxlength="4000" :disabled="disabled" />
      </details>
    </div>
    <footer>
      <button type="button" class="cancel" :disabled="disabled" @click="$emit('pause')">Cancel</button>
      <div class="decisions">
        <button type="button" class="deny" :disabled="disabled" @click="$emit('respond', { approved: false, reason: feedback.trim() || undefined })">Deny</button>
        <button type="button" class="approve" :disabled="disabled" @click="$emit('respond', { approved: true })">{{ toolName === 'Read' ? 'Approve' : 'Allow once' }}</button>
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { ClaudeFileApprovalReview } from '#features/code/common/native-file-approval.ts'
defineProps<{ toolName: 'Read' | 'Bash' | 'Write' | 'Edit'; review?: ClaudeFileApprovalReview; title: string; question: string; filePath?: string; command?: string; cwd?: string; reason?: string; disabled: boolean }>()
defineEmits<{ respond: [response: { approved: boolean; reason?: string }]; pause: [] }>()
const feedback = ref('')
</script>

<style scoped>
.native-tool-approval { display: flex; flex-direction: column; min-height: 0; height: 100%; overflow: hidden; border: 1px solid rgb(255 255 255 / .1); border-radius: 12px; background: #232323; color: #e5e5e5; }
header { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px 8px; }
.eyebrow { color: #b8a887; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
h2 { margin: 0; font-size: 14px; font-weight: 600; }
.details { flex: 1; min-height: 0; overflow-y: auto; padding: 0 16px 10px; font-size: 12px; line-height: 1.5; }
.question { margin: 0 0 6px; color: #aaa; }
code { white-space: pre-wrap; display: block; overflow-wrap: anywhere; padding: 8px 10px; border-radius: 6px; background: #191919; font-size: 11px; }
.change-review { margin-top: 10px; }
.change-label { margin: 8px 0 4px; color: #aaa; }
code.before { border-left: 2px solid #d28c8c; }
code.after { border-left: 2px solid #8fba99; }
.reason { margin: 8px 0; color: #aaa; overflow-wrap: anywhere; }
details { margin-top: 10px; color: #aaa; }
summary { cursor: pointer; font-size: 11px; }
textarea { display: block; width: 100%; margin-top: 6px; padding: 6px; resize: vertical; border: 1px solid #555; border-radius: 6px; background: #191919; color: #eee; }
footer { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-top: 1px solid rgb(255 255 255 / .07); }
.decisions { display: flex; gap: 8px; }
button { border-radius: 6px; padding: 7px 12px; font-size: 12px; font-weight: 500; cursor: pointer; }
button:focus-visible, summary:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
button:disabled { opacity: .5; cursor: default; }
.cancel { color: #aaa; background: transparent; }
.deny { background: #3b3b3b; color: #eee; }
.approve { background: #e5e5e5; color: #202020; }
button:hover:not(:disabled) { filter: brightness(1.12); }
</style>
