import { z } from 'zod'

/** Semantic controls from one currently mounted original Permissions dialog. */
export const claudePermissionsSnapshot = z.object({
  title: z.string().max(65536),
  tabs: z.array(z.object({ value: z.string().min(1).max(128), label: z.string().max(1024), selected: z.boolean() }).strict()).max(16),
  paragraphs: z.array(z.string().max(65536)).max(256),
  choices: z.array(z.object({ value: z.string().min(1).max(16384), label: z.string().max(65536), disabled: z.boolean() }).strict()).max(2048),
  search: z.string().max(16384).optional(),
  form: z.object({ value: z.string().max(16384), placeholder: z.string().max(4096), multiline: z.boolean(), submitLabel: z.string().max(1024) }).strict().optional(),
  readOnly: z.boolean(),
}).strict()
export const claudePermissionsOperation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('tab'), value: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal('select'), value: z.string().min(1).max(16384) }).strict(),
  z.object({ action: z.literal('search'), value: z.string().max(16384) }).strict(),
  z.object({ action: z.literal('submit'), value: z.string().max(16384) }).strict(),
  z.object({ action: z.literal('cancel') }).strict(),
])
export type ClaudePermissionsSnapshot = z.infer<typeof claudePermissionsSnapshot>
export type ClaudePermissionsOperation = z.infer<typeof claudePermissionsOperation>
