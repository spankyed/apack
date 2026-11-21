import {z} from 'zod'
import {claudeSettingsEditorCommand} from './native-settings.ts'

/** Billing retains native editor validation; only credit actions cross this route. */
export const claudeCreditOperation = z.union([
 z.object({kind:z.literal('read')}).strict(),
 z.object({kind:z.literal('editor'),revision:z.string().regex(/^[a-f0-9]{64}$/),editorRevision:z.string().regex(/^[a-f0-9]{64}$/),command:claudeSettingsEditorCommand.refine(command=>['change','select','save','cancel'].includes(command.action),'Not a native credit action')}).strict(),
])
export const claudeCreditRequest = z.object({requestId:z.string().uuid(),operation:claudeCreditOperation}).strict()
export type ClaudeCreditRequest = z.infer<typeof claudeCreditRequest>
