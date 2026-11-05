import { ClaudeUiApprovalAnswerSchema, type ClaudeUiApprovalAnswer } from '../../../common/native-approval.ts'
import type { ClaudeBackgroundDesktopOwner } from './background-status-observer.ts'
import type { ClaudeBackgroundApproval } from './background-controls.ts'

const answerSubtypes: Record<ClaudeBackgroundApproval['kind'], string> = {bash:'apack_answer_bash_dialog',file:'apack_answer_file_dialog',workflow:'apack_answer_workflow_dialog',plan:'apack_answer_plan_dialog',tool:'apack_answer_tool_permission_dialog',generic:'apack_answer_generic_tool_permission_dialog'}
export interface ClaudeUiApprovalSource {
  read(): ClaudeBackgroundApproval | undefined
  subscribe(listener: () => void): () => void
  answer(control: ClaudeBackgroundApproval, response: ClaudeUiApprovalAnswer): Promise<void>
}

/** Only the selected original child may consume its live choices; never construct permission updates. */
export function createClaudeChildApprovalSource(owner: ClaudeBackgroundDesktopOwner): ClaudeUiApprovalSource {
  let answering = false
  const read = () => { const value = owner.controls.value; return value?.kind !== 'question' ? value : undefined }
  return {
    read, subscribe: owner.controls.subscribe,
    async answer(control, raw) {
      const current = read(), response = ClaudeUiApprovalAnswerSchema.parse(raw)
      if (answering || !current || current.kind !== control.kind || current.dialog.id !== control.dialog.id || current.dialog.revision !== control.dialog.revision || current.dialog.requestId !== control.dialog.requestId || current.dialog.sessionId !== control.dialog.sessionId || current.dialog.sessionId !== owner.identity.activeSessionId) throw new Error('Background approval changed or is already being answered')
      const d = current.dialog
      const request: Record<string, unknown> & {subtype: string} = {subtype: answerSubtypes[current.kind], id: d.id, revision: d.revision, session_id: d.sessionId, decision: response.approved ? 'allow' : 'deny', ...(response.reason ? {feedback: response.reason} : {})}
      if (response.cancelled && current.kind !== 'generic') throw new Error('Native cancellation is unavailable for this approval')
      switch (current.kind) {
        case 'bash': {
          if (response.approved) {
            const choice = current.dialog.choices?.find(choice => choice.value === response.choice)
            if (!choice || choice.value === 'no' || choice.token !== response.choiceToken) throw new Error('Native Bash choice changed or is unavailable')
            Object.assign(request, {choice: choice.value, choiceToken: choice.token, ...(response.prefix !== undefined ? {prefix: response.prefix} : {})})
            delete request.feedback
          }
          break
        }
        case 'plan':
          if (response.approved && !current.dialog.presentation.choices.some(choice => choice.value === response.choice)) throw new Error('Native plan choice changed')
          Object.assign(request, {choice: response.approved ? response.choice : 'no', ...(response.plan !== undefined ? {plan: response.plan} : {})})
          break
        case 'file':
          if (response.approved) {
            const choice = current.dialog.approval?.choices.find(choice => choice.value === response.choice && choice.decision === 'allow')
            if (!current.dialog.approval?.ready || !choice || current.dialog.approval.token !== response.choiceToken) throw new Error('Native file choice changed or is unavailable')
            Object.assign(request, {choice: choice.value, choiceToken: response.choiceToken})
          }
          break
        default: {
          const presentation = current.dialog.presentation
          if (!presentation.ready || presentation.token !== response.choiceToken) throw new Error('Native approval choices changed or are unavailable')
          if (response.cancelled) {
            if (current.kind !== 'generic' || !current.dialog.presentation.canCancel || response.approved) throw new Error('Native approval cannot be cancelled')
            request.decision = 'cancel'; request.choice = ''
          } else {
            const choice = presentation.choices.find(choice => choice.value === response.choice && choice.decision === request.decision)
            if (!choice) throw new Error('Native approval choice changed')
            request.choice = choice.value
          }
          request.choiceToken = response.choiceToken
          if (current.kind !== 'workflow') request.toolName = current.dialog.toolName
        }
      }
      answering = true
      try {
        const result = await owner.transport.request(request) as {answered?: unknown}
        if (result.answered !== true) throw new Error('Native approval was not acknowledged')
        owner.controls.settled(d.id, d.revision)
      } finally { answering = false }
    },
  }
}
