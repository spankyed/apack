import { z } from 'zod'

/** Semantic controls from one currently mounted original Permissions dialog. */
export const claudePermissionsSnapshot = z.object({
  title: z.string().max(65536),
  tabs: z.array(z.object({ value: z.string().min(1).max(128), label: z.string().max(1024), selected: z.boolean() }).strict()).max(16),
  paragraphs: z.array(z.string().max(65536)).max(256),
  choices: z.array(z.object({ value: z.string().min(1).max(16384), label: z.string().max(65536), description: z.string().max(65536).optional(), disabled: z.boolean() }).strict()).max(2048),
  defaultFocusValue: z.string().max(16384).optional(),
  search: z.string().max(16384).optional(),
  searchScope: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  form: z.object({
    value: z.string().max(16384), placeholder: z.string().max(4096), multiline: z.boolean(), submitLabel: z.string().max(1024),
    live: z.object({
      kind: z.enum(['directory', 'autoRule']),
      id: z.string().regex(/^[a-f0-9]{64}$/), revision: z.string().regex(/^[a-f0-9]{64}$/),
      problem: z.string().max(65536).optional(), selectedValue: z.string().max(16384).optional(),
      suggestions: z.array(z.object({
        value: z.string().min(1).max(16384), label: z.string().max(65536), description: z.string().max(65536).optional(), token: z.string().regex(/^[a-f0-9]{64}$/),
      }).strict()).max(128),
    }).strict().optional(),
  }).strict().optional(),
  readOnly: z.boolean(),
}).strict()
export const claudePermissionsOperation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('tab'), value: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal('select'), value: z.string().min(1).max(16384) }).strict(),
  z.object({ action: z.literal('search'), scope: z.string().regex(/^[a-f0-9]{64}$/), value: z.string().max(16384) }).strict(),
  z.object({ action: z.literal('change'), scope: z.string().regex(/^[a-f0-9]{64}$/), value: z.string().max(16384) }).strict(),
  z.object({ action: z.literal('complete'), scope: z.string().regex(/^[a-f0-9]{64}$/), value: z.string().min(1).max(16384), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal('submit'), value: z.string().max(16384), scope: z.string().regex(/^[a-f0-9]{64}$/).optional(), formRevision: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  z.object({ action: z.literal('cancel'), scope: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
])
export type ClaudePermissionsSnapshot = z.infer<typeof claudePermissionsSnapshot>
export type ClaudePermissionsOperation = z.infer<typeof claudePermissionsOperation>
