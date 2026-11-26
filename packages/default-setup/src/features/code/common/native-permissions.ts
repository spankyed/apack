import { z } from 'zod'
import {CLAUDE_NATIVE_EDITOR_MAX_BYTES} from './native-editor.ts'

const permissionsTextStyle = z.object({
  color: z.string().max(256).optional(), backgroundColor: z.string().max(256).optional(),
  bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(), inverse: z.boolean().optional(), dimColor: z.boolean().optional(),
}).strict()
const permissionsParagraph = z.object({
  runs: z.array(z.object({text: z.string().max(65536), style: permissionsTextStyle}).strict()).min(1).max(4096),
  role: z.literal('alert').optional(),
}).strict().refine(value => value.runs.reduce((size, run) => size + run.text.length, 0) <= 65536, 'Permission paragraph exceeds text bound')

/** Semantic controls from one currently mounted original Permissions dialog. */
export const claudePermissionsSnapshot = z.object({
  title: z.string().max(65536),
  tabs: z.array(z.object({ value: z.string().min(1).max(128), label: z.string().max(1024), selected: z.boolean() }).strict()).max(16),
  paragraphs: z.array(permissionsParagraph).max(256),
  choices: z.array(z.object({ value: z.string().min(1).max(16384), label: z.string().max(65536), description: z.string().max(65536).optional(), disabled: z.boolean(), approved: z.boolean().optional(), retryScheduled: z.boolean().optional(), retryAvailable: z.boolean().optional() }).strict()).max(2048),
  decisions: z.object({ approved: z.number().int().nonnegative().max(2048), retry: z.number().int().nonnegative().max(2048) }).strict().optional(),
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
  editor: z.object({id: z.string().uuid(), revision: z.string().regex(/^[a-f0-9]{64}$/), value: z.string().max(CLAUDE_NATIVE_EDITOR_MAX_BYTES), closing: z.boolean()}).strict().optional(),
  readOnly: z.boolean(),
}).strict() satisfies z.ZodType<ClaudePermissionsSnapshot>
export const claudePermissionsOperation = z.discriminatedUnion('action', [
  z.object({action: z.literal('externalSave'), id: z.string().uuid(), value: z.string().max(CLAUDE_NATIVE_EDITOR_MAX_BYTES).refine(value => new TextEncoder().encode(value).length <= CLAUDE_NATIVE_EDITOR_MAX_BYTES, 'Environment document exceeds the 8 MiB editor transport limit')}).strict(),
  z.object({action: z.literal('externalCancel'), id: z.string().uuid()}).strict(),
  z.object({ action: z.literal('tab'), value: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal('retry'), value: z.string().min(1).max(16384) }).strict(),
  z.object({ action: z.literal('select'), value: z.string().min(1).max(16384) }).strict(),
  z.object({ action: z.literal('search'), scope: z.string().regex(/^[a-f0-9]{64}$/), value: z.string().max(16384) }).strict(),
  z.object({ action: z.literal('change'), scope: z.string().regex(/^[a-f0-9]{64}$/), value: z.string().max(16384) }).strict(),
  z.object({ action: z.literal('complete'), scope: z.string().regex(/^[a-f0-9]{64}$/), value: z.string().min(1).max(16384), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal('submit'), value: z.string().max(16384), scope: z.string().regex(/^[a-f0-9]{64}$/).optional(), formRevision: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  z.object({ action: z.literal('cancel'), scope: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
]) satisfies z.ZodType<ClaudePermissionsOperation>
export type ClaudePermissionsSnapshot = {
  title: string
  tabs: {
    value: string
    label: string
    selected: boolean
  }[]
  paragraphs: {
    runs: {
      text: string
      style: {
        color?: string
        backgroundColor?: string
        bold?: boolean
        italic?: boolean
        underline?: boolean
        strikethrough?: boolean
        inverse?: boolean
        dimColor?: boolean
      }
    }[]
    role?: 'alert'
  }[]
  choices: {
    value: string
    label: string
    disabled: boolean
    description?: string
    approved?: boolean
    retryScheduled?: boolean
    retryAvailable?: boolean
  }[]
  readOnly: boolean
  decisions?: {
    approved: number
    retry: number
  }
  defaultFocusValue?: string
  search?: string
  searchScope?: string
  form?: {
    value: string
    placeholder: string
    multiline: boolean
    submitLabel: string
    live?: {
      kind: 'directory' | 'autoRule'
      id: string
      revision: string
      suggestions: {
        value: string
        label: string
        token: string
        description?: string
      }[]
      problem?: string
      selectedValue?: string
    }
  }
  editor?: {
    id: string
    revision: string
    value: string
    closing: boolean
  }
}
export type ClaudePermissionsOperation =
  | {
    action: 'externalSave'
    id: string
    value: string
  }
  | {
    action: 'externalCancel'
    id: string
  }
  | {
    action: 'tab'
    value: string
  }
  | {
    action: 'retry'
    value: string
  }
  | {
    action: 'select'
    value: string
  }
  | {
    action: 'search'
    scope: string
    value: string
  }
  | {
    action: 'change'
    scope: string
    value: string
  }
  | {
    action: 'complete'
    scope: string
    value: string
    token: string
  }
  | {
    action: 'submit'
    value: string
    scope?: string
    formRevision?: string
  }
  | {
    action: 'cancel'
    scope?: string
  }
