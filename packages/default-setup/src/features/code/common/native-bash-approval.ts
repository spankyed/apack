import { z } from 'zod'

/** Original mounted Bash choices, scoped to a native dialog revision. */
export const ClaudeBashApprovalPresentationSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  choices: z.array(z.object({ value: z.string().min(1).max(128), label: z.string().max(4000), prefix: z.string().max(4000).optional() })).max(16),
})
export type ClaudeBashApprovalPresentation = z.infer<typeof ClaudeBashApprovalPresentationSchema>
