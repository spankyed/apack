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
}).passthrough() satisfies z.ZodType<ClaudeQuestionCard>
export type ClaudeQuestionCard = {
  [x: string]: unknown
  questions: {
    [x: string]: unknown
    question: string
    header: string
    options: {
      [x: string]: unknown
      label: string
      description?: string
      preview?: string
    }[]
    multiSelect: boolean
    kind?: 'number' | 'text' | 'choice'
    description?: string
    placeholder?: string
    min?: number
    max?: number
    step?: number
    defaultValue?: number
    unit?: string
  }[]
  title?: string
}
export const ClaudeQuestionAnswerSchema = z.object({
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  annotations: z.record(z.string(), z.object({preview: z.string().optional(), notes: z.string().optional()}).strict()).optional(),
  response: z.string().optional(), followUp: z.boolean().optional(),
}).strict()
export const ClaudeQuestionPartialAnswerSchema = ClaudeQuestionAnswerSchema.pick({ answers: true, annotations: true }) satisfies z.ZodType<ClaudeQuestionPartialAnswer>
export type ClaudeQuestionPartialAnswer = {
  answers?: Record<string, string | string[]>
  annotations?: Record<string, { preview?: string | undefined; notes?: string | undefined; }>
}
export const CLAUDE_QUESTION_IMAGE_COUNT = 4
export const CLAUDE_QUESTION_IMAGE_BYTES = 10 * 1024 * 1024
export const CLAUDE_QUESTION_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export const ClaudeQuestionImagesSchema = z.array(z.object({
  mediaType: z.enum(CLAUDE_QUESTION_IMAGE_TYPES),
  data: z.string().min(4).max(Math.ceil(CLAUDE_QUESTION_IMAGE_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/).refine(data => data.length % 4 === 0),
}).strict()).min(1).max(CLAUDE_QUESTION_IMAGE_COUNT).refine(images => images.reduce((bytes, { data }) =>
  bytes + data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0), 0) <= CLAUDE_QUESTION_IMAGE_BYTES) satisfies z.ZodType<ClaudeQuestionImage[]>
export type ClaudeQuestionImage = {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  data: string
}

export interface ClaudeQuestionAnswer {
  answers?: Record<string, string | string[]>
  annotations?: Record<string, { preview?: string; notes?: string }>
  response?: string
  followUp?: boolean
}

export const ClaudeQuestionCountdownEventSchema = z.object({
  type: z.literal('system'),
  subtype: z.literal('apack_question_countdown'),
  session_id: z.string().min(1).max(256),
  dialog_id: z.string().min(1).max(256),
  revision: z.string().uuid(),
  request_id: z.string().min(1).max(256),
  sequence: z.number().int().positive().safe(),
  seconds: z.number().int().min(0).max(600).nullable(),
})
export const ClaudeQuestionPresentationSchema = z.object({
  notice: z.string().optional(),
  previewFormat: z.string().nullable(), extendedQuestions: z.boolean(), optionalDescriptions: z.boolean(),
  previews: z.array(z.object({ question: z.string(), option: z.string(), kind: z.enum(['full', 'withheld', 'empty']), markdown: z.string().optional(), html: z.string().optional() })).max(16),
}) satisfies z.ZodType<ClaudeQuestionPresentation>
export type ClaudeQuestionPresentation = {
  previewFormat: string | null
  extendedQuestions: boolean
  optionalDescriptions: boolean
  previews: {
    question: string
    option: string
    kind: 'empty' | 'full' | 'withheld'
    markdown?: string
    html?: string
  }[]
  notice?: string
}
