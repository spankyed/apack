import { z } from 'zod'

/** Preview and choices from the mounted native workflow permission dialog. */
export const ClaudeWorkflowApprovalSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/), ready: z.boolean(), withheld: z.boolean(),
  script: z.string().max(200000).optional(), args: z.string().max(200000).optional(),
  choices: z.array(z.object({ value: z.enum(['yes', 'yes-always', 'no']), label: z.string().max(4000), decision: z.enum(['allow', 'deny']), feedback: z.boolean() })).max(3),
}).refine(value => !value.withheld || value.script === undefined, 'Withheld script cannot be presented')
export type ClaudeWorkflowApproval = z.infer<typeof ClaudeWorkflowApprovalSchema>
