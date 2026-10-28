import { z } from 'zod'

/** Exact notice emitted by the reviewed 2.1.302 Opus 5 same-model refusal retry. */
export const claudeOpus5RefusalRetryNotice = "Opus 5's safeguards stopped the response above · continuing once with that noted"

const identity = { id: z.string().min(1).max(256), revision: z.string().uuid(), sessionId: z.string().uuid() }
const body = { title: z.string().max(16000), paragraphs: z.array(z.string().max(16000)).max(32) }
/** Native owns the dialog, available choices, timeout and acknowledgement. */
export const ClaudeNativeNoticeSchema = z.discriminatedUnion('kind', [
  z.object({ ...identity, ...body, kind: z.literal('managed_settings_security'), paragraphsAnsi: z.array(z.string().max(200000)).length(4), preferredChoice: z.enum(['policy_approve', 'policy_reject']), choices: z.array(z.object({ value: z.enum(['policy_approve', 'policy_reject']), label: z.string().min(1).max(4000) })).length(2) }).refine(value => value.paragraphs.length === value.paragraphsAnsi.length, 'Managed settings text/style rows must agree'),
  z.object({ ...identity, ...body, kind: z.literal('refusal_fallback_prompt'), helpUrl: z.string().url().startsWith('https://').max(4000).optional(), originalModel: z.string().max(16000), fallbackModel: z.string().max(16000), choices: z.array(z.object({ value: z.enum(['retry_fallback', 'edit_prompt']), label: z.string().min(1).max(4000) })).length(2) }),
  z.object({ ...identity, ...body, kind: z.literal('autocompact_offer'), selectedTokens: z.number().int().positive(), canPrevious: z.boolean(), canNext: z.boolean(), choices: z.array(z.object({ value: z.enum(['compact_accept', 'compact_keep']), label: z.string().min(1).max(4000) })).length(2) }),
  z.object({ ...identity, ...body, kind: z.literal('goal_proposal'), choices: z.array(z.object({ value: z.enum(['goal_decline', 'goal_accept']), label: z.string().min(1).max(4000) })).length(2) }),
  z.object({ ...identity, ...body, kind: z.literal('auto_mode_server_fallback'), helpUrl: z.string().max(4000) }),
  z.object({ ...identity, ...body, kind: z.literal('plugin_hint'), pluginName: z.string().max(16000), marketplaceName: z.string().max(16000), sourceCommand: z.string().max(16000), choices: z.array(z.object({ value: z.enum(['yes', 'no', 'disable']), label: z.string().min(1).max(4000) })).length(3) }),
  z.object({ ...identity, ...body, kind: z.literal('lsp_recommendation'), pluginName: z.string().max(16000), marketplaceName: z.string().max(16000), fileExtension: z.string().max(16000), choices: z.array(z.object({ value: z.enum(['yes', 'no', 'never', 'disable']), label: z.string().min(1).max(4000) })).length(4) }),
])
export type ClaudeNativeNotice = z.infer<typeof ClaudeNativeNoticeSchema>
export type ClaudeNativeNoticeResponse = Pick<ClaudeNativeNotice, 'id' | 'revision' | 'sessionId'> & { decision: 'policy_approve' | 'policy_reject' | 'compact_previous' | 'compact_next' | 'compact_accept' | 'compact_keep' | 'compact_dismiss' | 'goal_accept' | 'goal_decline' | 'retry_fallback' | 'edit_prompt' | 'cancelled' | 'continue' | 'interrupt' | 'yes' | 'no' | 'never' | 'disable' }
export function isClaudeNativeNoticeDecision(notice: ClaudeNativeNotice, decision: string): boolean {
  if (notice.kind === 'managed_settings_security') return notice.choices.some(choice => choice.value === decision)
  if (notice.kind === 'autocompact_offer') return decision === 'compact_dismiss' || decision === 'compact_previous' && notice.canPrevious || decision === 'compact_next' && notice.canNext || notice.choices.some(choice => choice.value === decision)
  if (notice.kind === 'goal_proposal') return notice.choices.some(choice => choice.value === decision)
  if (notice.kind === 'refusal_fallback_prompt') return decision === 'cancelled' || notice.choices.some(choice => choice.value === decision)
  return notice.kind === 'lsp_recommendation' || notice.kind === 'plugin_hint' ? notice.choices.some(choice => choice.value === decision) : decision === 'continue' || decision === 'interrupt'
}

/** Original dialog settlement identities, scoped to their native conversation. */
export const ClaudeNativeMessageRetirementsSchema = z.array(z.object({ sessionId: z.string().uuid(), uuids: z.array(z.string().uuid()), rewoundUserUuids: z.array(z.string().uuid()).optional(), rewoundNoticeUuids: z.array(z.string().uuid()).optional() }))
export type ClaudeNativeMessageRetirements = z.infer<typeof ClaudeNativeMessageRetirementsSchema>
