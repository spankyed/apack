import { z } from 'zod'

const identity = { id: z.string().min(1).max(256), revision: z.string().uuid(), sessionId: z.string().uuid() }
const body = { title: z.string().max(16000), paragraphs: z.array(z.string().max(16000)).max(32) }
/** Native owns the dialog, available choices, timeout and acknowledgement. */
export const ClaudeNativeNoticeSchema = z.discriminatedUnion('kind', [
  z.object({ ...identity, ...body, kind: z.literal('auto_mode_server_fallback'), helpUrl: z.string().max(4000) }),
  z.object({ ...identity, ...body, kind: z.literal('lsp_recommendation'), choices: z.array(z.object({ value: z.enum(['yes', 'no', 'never', 'disable']), label: z.string().min(1).max(4000) })).length(4) }),
])
export type ClaudeNativeNotice = z.infer<typeof ClaudeNativeNoticeSchema>
export type ClaudeNativeNoticeResponse = Pick<ClaudeNativeNotice, 'id' | 'revision' | 'sessionId'> & { decision: 'continue' | 'interrupt' | 'yes' | 'no' | 'never' | 'disable' }
export function isClaudeNativeNoticeDecision(notice: ClaudeNativeNotice, decision: string): boolean {
  return notice.kind === 'lsp_recommendation' ? notice.choices.some(choice => choice.value === decision) : decision === 'continue' || decision === 'interrupt'
}
