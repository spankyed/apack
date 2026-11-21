import { z } from 'zod'

/** MCP answers are independent of tool permission allow/deny and generic dialog results. */
export const ClaudeMcpElicitationAnswerSchema = z.object({
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string())])).optional(),
}).strict().superRefine((answer, context) => {
  if (answer.action !== 'accept' && answer.content !== undefined)
    context.addIssue({ code: 'custom', path: ['content'], message: 'Only accepted MCP elicitation can contain content' })
})
export type ClaudeMcpElicitationAnswer = z.infer<typeof ClaudeMcpElicitationAnswerSchema>
