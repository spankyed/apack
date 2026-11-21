import { z } from 'zod'

/** Preview and choices from the mounted native workflow permission dialog. */
export const ClaudeWorkflowApprovalSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/), ready: z.boolean(), withheld: z.boolean(),
  script: z.string().max(200000).optional(), args: z.string().max(200000).optional(),
  summary: z.array(z.object({ title: z.string().max(200000), detail: z.string().max(200000).optional(), prompts: z.array(z.string().max(200000)).max(4096) })).max(4096).optional(),
  canEdit: z.boolean().optional(), description: z.string().max(200000).optional(), raw: z.boolean().optional(), summaryUnavailable: z.boolean().optional(),
  choices: z.array(z.object({ value: z.enum(['yes', 'yes-always', 'no']), label: z.string().max(4000), decision: z.enum(['allow', 'deny']), feedback: z.boolean() })).max(3),
}).refine(value => !value.withheld || value.script === undefined && value.summary === undefined && value.description === undefined, 'Withheld script cannot be presented')
export type ClaudeWorkflowApproval = z.infer<typeof ClaudeWorkflowApprovalSchema>
