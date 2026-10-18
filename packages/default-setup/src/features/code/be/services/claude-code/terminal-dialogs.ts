import { ClaudeQuestionPresentationSchema } from '../../../common/native-question.ts'
import { z } from 'zod'

/** A one-time Read decision; native retains policy, input and dialog lifecycle ownership. */
export const ClaudeNativeReadDialogSchema = z.object({
  id: z.string().min(1).max(256), revision: z.string().uuid(), sessionId: z.string().uuid(),
  requestId: z.string().min(1).max(256), toolName: z.literal('Read'),
  title: z.string().max(1000), question: z.string().max(4000),
  reason: z.string().max(16000).optional(),
  input: z.record(z.string(), z.unknown()),
})
export const ClaudeNativeReadDialogsSchema = z.array(ClaudeNativeReadDialogSchema).max(1)
export type ClaudeNativeReadDialog = z.infer<typeof ClaudeNativeReadDialogSchema>
export interface ClaudeNativeReadDialogResponse {
  id: string
  revision: string
  sessionId: string
  decision: 'allow' | 'deny'
  feedback?: string
}

/** Native owns the shown card and answer admission, including richer form fields. */
export const ClaudeNativeQuestionDialogSchema = z.object({
  id: z.string().min(1).max(256), revision: z.string().uuid(), sessionId: z.string().uuid(),
  requestId: z.string().min(1).max(256), toolName: z.literal('AskUserQuestion'),
  shownInput: z.record(z.string(), z.unknown()),
  presentation: ClaudeQuestionPresentationSchema,
})
export const ClaudeNativeQuestionDialogsSchema = z.array(ClaudeNativeQuestionDialogSchema).max(1)
export type ClaudeNativeQuestionDialog = z.infer<typeof ClaudeNativeQuestionDialogSchema>
export interface ClaudeNativeQuestionDialogResponse {
  id: string
  revision: string
  sessionId: string
  answer: Record<string, unknown>
  renderToken?: string
  draftStarted?: boolean
}

export interface ClaudeNativeQuestionRenderRequest {
  id: string
  revision: string
  sessionId: string
  clientId: string
  viewport?: { columns: number; rows: number; isFullscreen?: boolean }
}
export const ClaudeNativeQuestionRenderSchema = z.object({
  tree: z.unknown(), props: z.record(z.string(), z.unknown()), rewritten: z.boolean(), hooked: z.boolean(),
  question: z.object({ token: z.string().uuid(), dialogId: z.string(), revision: z.string().uuid(), shownInput: z.record(z.string(), z.unknown()), presentation: ClaudeQuestionPresentationSchema }),
}).passthrough().refine(value => value.tree !== undefined, 'Native question drawing must contain a tree')
export type ClaudeNativeQuestionRender = z.infer<typeof ClaudeNativeQuestionRenderSchema>

export interface ClaudeNativeQuestionHoldRequest {
  id: string
  revision: string
  sessionId: string
  clientId: string
  renderToken: string
}
