import { z } from 'zod'

/** Original native preview or explicit withholding; never independently read or modify the file. */
export const ClaudeFileApprovalReviewSchema = z.object({
  withheld: z.boolean(), notice: z.string().max(16000).optional(),
  before: z.string().max(200000).optional(), after: z.string().max(200000).optional(),
  replaceAll: z.boolean().optional(),
}).refine(value => !value.withheld || value.before === undefined && value.after === undefined, 'Withheld native content must not be presented')
export type ClaudeFileApprovalReview = z.infer<typeof ClaudeFileApprovalReviewSchema>
