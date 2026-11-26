<template>
  <div class="background-approval">
    <NativePlanPanel v-if="frame.control.kind === 'plan'" :key="frame.id" :entering="frame.control.dialog.toolName === 'EnterPlanMode'" :presentation="frame.control.dialog.presentation" :reason="frame.control.dialog.reason" :disabled="disabled || !!frame.pending" cancel-label="Back to parent notes" @respond="respond" @pause="emit('leave', frameId)" />
    <NativeToolApproval v-else :key="frame.id" :tool-name="frame.control.dialog.toolName" :title="title" :question="question" :command="command" :file-path="filePath" :cwd="cwd" :reason="frame.control.dialog.reason"
      :bash="bash" :file="file" :review="review" :workflow="workflow" :tool="tool" :can-approve="canApprove" :can-cancel="generic?.canCancel ? true : undefined" :default-focus-value="generic?.defaultFocusValue" :choice-descriptions="generic?.choiceDescriptions"
      :cancel-label="generic?.canCancel ? 'Cancel' : 'Back to parent notes'" :disabled="disabled || !!frame.pending" @respond="respond" @pause="emit('leave', frameId)" @edit-workflow="emit('open-native', frameId)" />
    <p v-if="frame.problem" role="alert" class="background-approval__problem">{{ frame.problem }}</p>
  </div>
</template>
<script setup lang="ts">
import {computed} from 'vue'
import NativeToolApproval from './NativeToolApproval.vue'
import NativePlanPanel from './NativePlanPanel.vue'
import type {ClaudeUiApprovalFrame} from '#features/code/be/services/claude-code/ui-presentation.ts'
import type {ClaudeUiApprovalAnswer} from '#features/code/common/native-approval.ts'
const props = defineProps<{frame: ClaudeUiApprovalFrame; disabled: boolean}>()
const emit = defineEmits<{answer: [frameId: string, response: ClaudeUiApprovalAnswer]; leave: [frameId: string]; 'open-native': [frameId: string]}>()
// The parent keys this component by the displayed frame, including queued callbacks.
const frameId = props.frame.id
function respond(answer: ClaudeUiApprovalAnswer) { if (props.frame.id === frameId) emit('answer', frameId, answer) }
const control = computed(() => props.frame.control)
const generic = computed(() => control.value.kind === 'generic' ? control.value.dialog.presentation : undefined)
const tool = computed(() => control.value.kind === 'generic' || control.value.kind === 'tool' ? control.value.dialog.presentation : undefined)
const workflow = computed(() => control.value.kind === 'workflow' ? control.value.dialog.presentation : undefined)
const file = computed(() => control.value.kind === 'file' ? control.value.dialog.approval : undefined)
const review = computed(() => control.value.kind === 'file' ? control.value.dialog.review : undefined)
const bash = computed(() => control.value.kind === 'bash' && control.value.dialog.choices && control.value.dialog.choiceToken ? {choices: control.value.dialog.choices, token: control.value.dialog.choiceToken} : undefined)
const canApprove = computed(() => control.value.kind === 'bash' ? !!bash.value?.choices.some(choice => choice.value !== 'no') : control.value.kind === 'file' ? !!file.value?.ready && file.value.choices.some(choice => choice.decision === 'allow') : undefined)
const title = computed(() => control.value.kind === 'file' ? control.value.dialog.title : tool.value?.title ?? (control.value.kind === 'workflow' ? 'Run workflow' : 'Run shell command'))
const question = computed(() => control.value.kind === 'file' ? control.value.dialog.question : control.value.kind === 'workflow' ? 'Allow Claude to run this workflow?' : tool.value ? 'Review Claude’s request and choose an original permission.' : 'Allow Claude to run this command?')
const command = computed(() => control.value.kind === 'bash' ? control.value.dialog.command : undefined)
const cwd = computed(() => control.value.kind === 'bash' ? control.value.dialog.cwd : undefined)
const filePath = computed(() => { const value = control.value.dialog.input; const path = value.file_path ?? value.notebook_path; return typeof path === 'string' ? path : undefined })
</script>
<style scoped>
.background-approval {display:flex;flex:1;flex-direction:column;min-height:0;min-width:0}
.background-approval > :deep(.native-tool-approval) {flex:1}
.background-approval__problem {flex:none;padding:4px 8px;font-size:12px;color:#e4aaa1;overflow-wrap:anywhere}
</style>
