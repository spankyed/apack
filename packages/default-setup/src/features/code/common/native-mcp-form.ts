import { z } from 'zod'
const value = z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string())])
export const ClaudeNativeMcpFormSchema = z.object({
  id: z.string().min(1).max(256), revision: z.string().uuid(), sessionId: z.string().uuid(),
  token: z.string().regex(/^[a-f0-9]{64}$/), ready: z.boolean(),
  serverName: z.string().max(4000), message: z.string().max(65536),
  schema: z.record(z.string(), z.unknown()), propertyOrder: z.array(z.string()).max(128),
  values: z.record(z.string(), value), errors: z.record(z.string(), z.string()), resolvingFields: z.array(z.string()),
  expandedAccordion: z.string().max(256).optional(),
  currentFieldIndex: z.number().int().nonnegative().optional(), focusedButton: z.enum(['accept', 'decline']).nullable(),
  textInputValue: z.string(), textInputCursorOffset: z.number().int().nonnegative().optional(),
})
export type ClaudeNativeMcpForm = z.infer<typeof ClaudeNativeMcpFormSchema>
export const ClaudeNativeMcpFormOperationSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('edit'), field: z.string().max(256), value: value.nullable(), cursorOffset: z.number().int().nonnegative().optional() }).strict(),
  z.object({ operation: z.literal('focus'), field: z.string().max(256) }).strict(),
  z.object({ operation: z.literal('cursor'), field: z.string().max(256), cursorOffset: z.number().int().nonnegative() }).strict(),
  z.object({ operation: z.enum(['accept', 'decline', 'cancel']) }).strict(),
])
export type ClaudeNativeMcpFormOperation = z.infer<typeof ClaudeNativeMcpFormOperationSchema>
export interface ClaudeNativeMcpFormRequest { id: string; revision: string; sessionId: string; token: string; action: ClaudeNativeMcpFormOperation }
