import {z} from 'zod'
import {claudeSettingsEditorCommand} from './native-settings.ts'

/** Billing retains native editor validation; only credit actions cross this route. */
export const claudeCreditOperation = z.union([
 z.object({kind:z.literal('read')}).strict(),
 z.object({kind:z.literal('editor'),revision:z.string().regex(/^[a-f0-9]{64}$/),editorRevision:z.string().regex(/^[a-f0-9]{64}$/),command:claudeSettingsEditorCommand.refine(command=>['change','select','save','cancel'].includes(command.action),'Not a native credit action')}).strict(),
])
export const claudeCreditRequest = z.object({requestId:z.string().uuid(),operation:claudeCreditOperation}).strict() satisfies z.ZodType<ClaudeCreditRequest>
export type ClaudeCreditRequest = {
  requestId: string
  operation: {
    kind: 'read'
  } | {
    kind: 'editor'
    revision: string
    editorRevision: string
    command: {
      action: 'change'
      formId: string
      key: string
      value: string
    } | {
      action: 'setGroup'
      key: string
      value: string | boolean
    } | {
      action: 'select'
      value: string
    } | {
      action: 'preview'
      value: string
    } | {
      action: 'themeEdit' | 'themeReset'
      value: string
    } | {
      action: 'toggleSyntax'
    } | {
      action: 'focusModel'
      value: string
    } | {
      action: 'adjustEffort'
      direction: 'left' | 'right'
    } | {
      action: 'save'
      values: Record<string, string>
    } | {
      action: 'cancel'
    }
  }
}
