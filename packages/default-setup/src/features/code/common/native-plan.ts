import { z } from 'zod'

export const ClaudePlanChoiceSchema = z.object({ value: z.string().max(64), label: z.string().max(160), mode: z.enum(['plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions']), clearContext: z.boolean() })
export const ClaudePlanPresentationSchema = z.object({
  plan: z.string().max(200000), planFilePath: z.string().max(16384).optional(),
  initialChoice: z.string().max(64), empty: z.boolean(), withheld: z.boolean(), choices: z.array(ClaudePlanChoiceSchema).max(4),
}).refine(value => !value.withheld || value.plan === '' && value.choices.length === 0, 'Withheld plans cannot offer approval').refine(value => value.choices.length ? value.choices.some(choice => choice.value === value.initialChoice) : value.initialChoice === '', 'Initial choice must be offered by native')
export type ClaudePlanPresentation = z.infer<typeof ClaudePlanPresentationSchema>
