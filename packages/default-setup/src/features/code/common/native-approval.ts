import { z } from 'zod'

/** App decisions carry original choice tokens; native owns their admission and effects. */
export const ClaudeUiApprovalAnswerSchema = z.object({
  approved: z.boolean(), cancelled: z.boolean().optional(), reason: z.string().max(4000).optional(),
  choice: z.string().max(128).optional(), choiceToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  prefix: z.string().max(4000).optional(), plan: z.string().max(200000).optional(),
}).strict()
export type ClaudeUiApprovalAnswer = z.infer<typeof ClaudeUiApprovalAnswerSchema>
