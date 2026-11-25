import { z } from 'zod'

/** Original native preview or explicit withholding; never independently read or modify the file. */
export const ClaudeFileApprovalReviewSchema = z.object({
  withheld: z.boolean(), notice: z.string().max(16000).optional(),
  before: z.string().max(200000).optional(), after: z.string().max(200000).optional(),
  replaceAll: z.boolean().optional(),
  notebook: z.object({ editMode: z.enum(['replace', 'insert', 'delete']), cellId: z.string().max(16000).optional(), cellType: z.enum(['code', 'markdown']).optional() }).optional(),
}).refine(value => !value.withheld || value.before === undefined && value.after === undefined, 'Withheld native content must not be presented') satisfies z.ZodType<ClaudeFileApprovalReview>
export type ClaudeFileApprovalReview = {
  withheld: boolean
  notice?: string
  before?: string
  after?: string
  replaceAll?: boolean
  notebook?: {
    editMode: 'replace' | 'insert' | 'delete'
    cellId?: string
    cellType?: 'markdown' | 'code'
  }
}

/** Choices and readiness borrowed from the original mounted native file dialog. */
export const ClaudeFileApprovalPresentationSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/), ready: z.boolean(),
  choices: z.array(z.object({ value: z.string().min(1).max(128), label: z.string().max(4000), decision: z.enum(['allow', 'deny']), feedback: z.boolean() })).max(16),
}) satisfies z.ZodType<ClaudeFileApprovalPresentation>
export type ClaudeFileApprovalPresentation = {
  token: string
  ready: boolean
  choices: {
    value: string
    label: string
    decision: 'deny' | 'allow'
    feedback: boolean
  }[]
}
