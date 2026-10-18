import { z } from 'zod'

// Presentation shape only. The original native tool owns answer admission and eligibility.
export const ClaudeQuestionCardSchema = z.object({
  title: z.string().optional(),
  questions: z.array(z.object({
    question: z.string(), header: z.string(), kind: z.enum(['choice', 'text', 'number']).optional(),
    description: z.string().optional(), placeholder: z.string().optional(),
    options: z.array(z.object({ label: z.string(), description: z.string().optional(), preview: z.string().optional() }).passthrough()).max(4).default([]),
    multiSelect: z.boolean().default(false), min: z.number().optional(), max: z.number().optional(),
    step: z.number().positive().optional(), defaultValue: z.number().optional(), unit: z.string().optional(),
  }).passthrough()).min(1).max(4),
}).passthrough()
export type ClaudeQuestionCard = z.infer<typeof ClaudeQuestionCardSchema>
export interface ClaudeQuestionAnswer {
  answers?: Record<string, string | string[]>
  annotations?: Record<string, { preview?: string; notes?: string }>
  response?: string
  followUp?: boolean
}

export const ClaudeQuestionPresentationSchema = z.object({
  previewFormat: z.string().nullable(), extendedQuestions: z.boolean(), optionalDescriptions: z.boolean(),
  previews: z.array(z.object({ question: z.string(), option: z.string(), kind: z.enum(['full', 'withheld', 'empty']), markdown: z.string().optional() })).max(16),
})
export type ClaudeQuestionPresentation = z.infer<typeof ClaudeQuestionPresentationSchema>
