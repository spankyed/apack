import type { ClaudeHooks } from './hooks.ts'
/**
 * Type definitions + Zod schemas for the Claude Code stream-json wire protocol.
 *
 * The CLI is fast-moving and routinely adds fields; every object schema uses
 * `.passthrough()` so unknown fields survive round-trips and we only validate
 * the bits we actually read. Explicit TS types are exported next to each schema
 * so pack-types.d.ts stays free of Zod types.
 *
 * Source of truth for field shapes: the stream-json writer at
 * `src/cli/structuredIO.ts` and the SDK Zod schemas at
 * `src/entrypoints/sdk/coreSchemas.ts` in the leaked Claude Code source.
 */

import { z } from 'zod'
import { ClaudeRateLimitInfoSchema, type ClaudeRateLimitInfo } from '../../../common/native-billing.ts'

// ─── Primitives ──────────────────────────────────────────────────────────────

/**
 * Permission modes accepted by `claude --permission-mode`. Names match the
 * CLI's Commander validator exactly (see the leaked source at
 * `src/types/permissions.ts` or the error message the CLI prints when you
 * pass an unknown value).
 *
 * Interoperation note: only `default`, `plan`, and `acceptEdits` emit
 * `can_use_tool` control_requests that our wrapper's `onPermissionRequest`
 * hook can intercept. `bypassPermissions` and `dontAsk` short-circuit the
 * permission resolver entirely; `auto` is feature-gated and uses an ML
 * classifier instead of prompting.
 */
export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions'
  | 'dontAsk'
  | 'auto'

export const PermissionModeSchema = z.enum([
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'dontAsk',
  'auto',
]) satisfies z.ZodType<PermissionMode>

export type Thinking = 'enabled' | 'adaptive' | 'disabled'
export const ThinkingSchema: z.ZodType<Thinking> = z.enum(['enabled', 'adaptive', 'disabled'])

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export const EffortSchema: z.ZodType<Effort> = z.enum(['low', 'medium', 'high', 'xhigh', 'max'])

export type SettingScope = 'user' | 'project' | 'local'
export const SettingScopeSchema: z.ZodType<SettingScope> = z.enum(['user', 'project', 'local'])

// ─── Stream-json stdout lines (discriminated union on `type`) ────────────────

interface PassthroughFields {
  [key: string]: unknown
}

interface UuidLine extends PassthroughFields {
  uuid?: string
  session_id?: string
}

const withUuid = z.object({
  uuid: z.string().optional(),
  session_id: z.string().optional(),
})

/** `{type:'user', message:{role:'user', content:...}}` — replayed user turn. */
export interface UserStreamLine extends UuidLine {
  type: 'user'
  message: {
    role: 'user'
    content: string | any[]
    [key: string]: unknown
  }
  parent_tool_use_id?: string | null
  isReplay?: boolean
  isSynthetic?: boolean
}
export const UserStreamLineSchema: z.ZodType<UserStreamLine> = withUuid.extend({
  type: z.literal('user'),
  message: z.object({
    role: z.literal('user'),
    content: z.union([z.string(), z.array(z.any())]),
  }).passthrough(),
  parent_tool_use_id: z.string().nullable().optional(),
  isReplay: z.boolean().optional(),
  isSynthetic: z.boolean().optional(),
}).passthrough()

/** `{type:'assistant', message:{role:'assistant', content:[...blocks]}}` */
export interface AssistantStreamLine extends UuidLine {
  type: 'assistant'
  message: {
    role: 'assistant'
    content: any[]
    [key: string]: unknown
  }
  parent_tool_use_id?: string | null
  error?: {
    type: string
    message: string
    [key: string]: unknown
  }
}
export const AssistantStreamLineSchema: z.ZodType<AssistantStreamLine> = withUuid.extend({
  type: z.literal('assistant'),
  message: z.object({
    role: z.literal('assistant'),
    content: z.array(z.any()),
  }).passthrough(),
  parent_tool_use_id: z.string().nullable().optional(),
  error: z.object({
    type: z.string(),
    message: z.string(),
  }).passthrough().optional(),
}).passthrough()

/** `{type:'stream_event', event:{...}}` — partial message chunks. */
export interface StreamEventLine extends UuidLine {
  type: 'stream_event'
  event: {
    type: string
    [key: string]: unknown
  }
  parent_tool_use_id?: string | null
}
export const StreamEventLineSchema: z.ZodType<StreamEventLine> = withUuid.extend({
  type: z.literal('stream_event'),
  event: z.object({ type: z.string() }).passthrough(),
  parent_tool_use_id: z.string().nullable().optional(),
}).passthrough()

/** Tool-use progress heartbeat. */
export interface ToolProgressLine extends UuidLine {
  type: 'tool_progress'
  tool_use_id: string
  tool_name: string
  elapsed_time_seconds?: number
  parent_tool_use_id?: string | null
}
export const ToolProgressLineSchema: z.ZodType<ToolProgressLine> = withUuid.extend({
  type: z.literal('tool_progress'),
  tool_use_id: z.string(),
  tool_name: z.string(),
  elapsed_time_seconds: z.number().optional(),
  parent_tool_use_id: z.string().nullable().optional(),
}).passthrough()

/** System lines — many subtypes, all passthrough. */
export interface SystemLine extends UuidLine {
  type: 'system'
  subtype: string
}
export const SystemLineSchema: z.ZodType<SystemLine> = withUuid.extend({
  type: z.literal('system'),
  subtype: z.string(),
}).passthrough()

/** `system/init` — the well-typed subset callers usually want. */
export interface SystemInitLine extends SystemLine {
  subtype: 'init'
  session_id: string
  cwd?: string
  model?: string
  tools?: string[]
  mcp_servers?: Array<{ name: string; status: string }>
  permissionMode?: PermissionMode
  slash_commands?: string[]
  output_style?: string
  claude_code_version?: string
}

/** Rate limit warnings. */
export interface RateLimitLine extends UuidLine {
  type: 'rate_limit_event'
  rate_limit_info: ClaudeRateLimitInfo
}
export const RateLimitLineSchema: z.ZodType<RateLimitLine> = withUuid.extend({
  type: z.literal('rate_limit_event'),
  rate_limit_info: ClaudeRateLimitInfoSchema,
}).passthrough()

/** Tool-use summary ("Read 2 files, wrote 1 file"). */
export interface ToolUseSummaryLine extends UuidLine {
  type: 'tool_use_summary'
  summary: string
  preceding_tool_use_ids?: string[]
}
export const ToolUseSummaryLineSchema: z.ZodType<ToolUseSummaryLine> = withUuid.extend({
  type: z.literal('tool_use_summary'),
  summary: z.string(),
  preceding_tool_use_ids: z.array(z.string()).optional(),
}).passthrough()

/** Native result: per-input usage/duration_ms, with cumulative process cost/modelUsage. */
export interface ResultLine extends UuidLine {
  type: 'result'
  subtype: string
  /** Correlates a host input; autonomous results can omit it. */
  user_message_uuid?: string
  queued_turn_count?: number
  is_error?: boolean
  duration_ms?: number
  duration_api_ms?: number
  num_turns?: number
  result?: string
  stop_reason?: string | null
  total_cost_usd?: number
  usage?: Record<string, unknown>
  modelUsage?: Record<string, any>
  permission_denials?: Array<Record<string, unknown>>
  structured_output?: unknown
  errors?: string[]
}
export const ResultLineSchema: z.ZodType<ResultLine> = withUuid.extend({
  type: z.literal('result'),
  subtype: z.string(),
  /** Correlates a host input; autonomous results can omit it. */
  user_message_uuid: z.string().optional(),
  queued_turn_count: z.number().int().nonnegative().optional(),
  is_error: z.boolean().optional(),
  duration_ms: z.number().optional(),
  duration_api_ms: z.number().optional(),
  num_turns: z.number().optional(),
  result: z.string().optional(),
  stop_reason: z.string().nullable().optional(),
  total_cost_usd: z.number().optional(),
  usage: z.object({}).passthrough().optional(),
  modelUsage: z.record(z.string(), z.any()).optional(),
  permission_denials: z.array(z.object({}).passthrough()).optional(),
  structured_output: z.unknown().optional(),
  errors: z.array(z.string()).optional(),
}).passthrough()

/** Control request from CLI → wrapper. Dispatched to the control router. */
export interface ControlRequestLine extends PassthroughFields {
  type: 'control_request'
  request_id: string
  request: {
    subtype: string
    [key: string]: unknown
  }
}
export const ControlRequestLineSchema: z.ZodType<ControlRequestLine> = z.object({
  type: z.literal('control_request'),
  request_id: z.string(),
  request: z.object({ subtype: z.string() }).passthrough(),
}).passthrough()

/** Control response — normally wrapper → CLI, but can echo on stdout too. */
export interface ControlResponseLine extends PassthroughFields {
  type: 'control_response'
  response: {
    subtype: 'success' | 'error'
    request_id: string
    [key: string]: unknown
  }
}
export const ControlResponseLineSchema: z.ZodType<ControlResponseLine> = z.object({
  type: z.literal('control_response'),
  response: z.object({
    subtype: z.enum(['success', 'error']),
    request_id: z.string(),
  }).passthrough(),
}).passthrough()

/** `control_cancel_request` — CLI withdraws a pending control request. */
export interface ControlCancelLine extends PassthroughFields {
  type: 'control_cancel_request'
  request_id: string
}
export const ControlCancelLineSchema: z.ZodType<ControlCancelLine> = z.object({
  type: z.literal('control_cancel_request'),
  request_id: z.string(),
}).passthrough()

/** `keep_alive` — NDJSON heartbeat, silently ignored by readers. */
export interface KeepAliveLine {
  type: 'keep_alive'
}
export const KeepAliveLineSchema: z.ZodType<KeepAliveLine> = z.object({ type: z.literal('keep_alive') })

/** Native input queue lifecycle; command_uuid identifies the submitted user message. */
export interface CommandLifecycleLine extends PassthroughFields {
  type: 'command_lifecycle'
  command_uuid: string
  state: 'queued' | 'started' | 'completed' | 'cancelled' | 'discarded' | 'refused'
  ran_ahead?: true
  uuid: string
  session_id: string
}
export const CommandLifecycleLineSchema: z.ZodType<CommandLifecycleLine> = z.object({
  type: z.literal('command_lifecycle'),
  command_uuid: z.string(),
  state: z.enum(['queued', 'started', 'completed', 'cancelled', 'discarded', 'refused']),
  ran_ahead: z.literal(true).optional(),
  uuid: z.string(),
  session_id: z.string(),
}).passthrough()

/** Fallthrough catch-all: the CLI adds new top-level types regularly. */
export interface UnknownLine extends PassthroughFields {
  type: string
}
export const UnknownLineSchema: z.ZodType<UnknownLine> = z.object({ type: z.string() }).passthrough()

/**
 * Every line type we explicitly recognise. Each variant has a literal
 * `type` discriminator so a `switch(line.type)` narrows exhaustively
 * without casts. Used internally by `pump()` in `query.ts`.
 */
/** Emitted by the pump when a JSON line fails to parse. */
export interface ParseErrorLine {
  type: '__parse_error'
  raw: string
  error: string
}

export type KnownStreamLine =
  | UserStreamLine
  | AssistantStreamLine
  | StreamEventLine
  | ToolProgressLine
  | SystemLine
  | RateLimitLine
  | ToolUseSummaryLine
  | ResultLine
  | ControlRequestLine
  | ControlResponseLine
  | ControlCancelLine
  | KeepAliveLine
  | CommandLifecycleLine
  | ParseErrorLine

/**
 * Public stream-line type. Callers iterate these out of `query().events`.
 * Includes `UnknownLine` as a catch-all so the CLI can add new top-level
 * types without breaking the wrapper.
 */
export type StreamLine = KnownStreamLine | UnknownLine

// ─── Control-request payloads we explicitly understand ───────────────────────

/** `control_request` subtype=`can_use_tool` — the permission prompt. */
export interface CanUseToolRequest {
  subtype: 'can_use_tool'
  tool_name: string
  input: Record<string, unknown>
  tool_use_id: string
  agent_id?: string
  blocked_path?: string
  decision_reason?: string
  title?: string
  description?: string
}

/** `control_request` subtype=`initialize` — session handshake. */
export interface InitializeRequest {
  subtype: 'initialize'
  hooks?: Record<string, unknown>
  sdkMcpServers?: string[]
  systemPrompt?: string
  appendSystemPrompt?: string
  agents?: Record<string, unknown>
}

/**
 * The response shape for `can_use_tool`, as required by the Claude Code
 * CLI at:
 *   packages/claude-code/src/utils/permissions/PermissionPromptToolResultSchema.ts
 *
 * - `allow` MUST include `updatedInput` (Record<string, unknown>). The CLI
 *   treats an empty object as "run with the original tool input", so
 *   callers that don't intend to modify the input should echo `req.input`
 *   back verbatim — this is the safer default.
 * - `deny` MUST include a `message` string. Callers that don't have a
 *   specific reason should send a generic "User denied".
 *
 * Malformed responses (missing required fields) are rejected by the CLI
 * with a `ZodError: invalid_union` that surfaces as "Tool permission
 * request failed: …" on the user's tool-activity row. Both required
 * fields are enforced statically here so that class of bug can't
 * silently reoccur at the call site.
 */
export type PermissionDecision =
  | {
      behavior: 'allow'
      updatedInput: Record<string, unknown>
      updatedPermissions?: Array<Record<string, unknown>>
      toolUseID?: string
      decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject'
    }
  | {
      behavior: 'deny'
      message: string
      interrupt?: boolean
      toolUseID?: string
      decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject'
    }

/** Caller hook: decide a tool permission request. */
export type PermissionHandler = (
  request: CanUseToolRequest,
) => PermissionDecision | Promise<PermissionDecision>

/** Caller hook: handle arbitrary control request subtypes we don't special-case. */
export type ControlRequestHandler = (
  request: { subtype: string } & Record<string, unknown>,
) => unknown | Promise<unknown>

// ─── Query options ───────────────────────────────────────────────────────────

/** A native `--agents` JSON definition. Claude validates values and owns feature admission. */
export interface ClaudeInlineAgentDefinition {
  description: string
  prompt: string
  tools?: string[]
  disallowedTools?: string[]
  model?: string
  effort?: Effort | number
  permissionMode?: PermissionMode
  /** Existing MCP server names or original inline server configurations. */
  mcpServers?: Array<string | Record<string, Record<string, unknown>>>
  /** Native settings hook declarations, serialized as JSON. */
  hooks?: Record<string, unknown>
  maxTurns?: number
  /** Native compaction ceiling in tokens, from 100,000 to 1,000,000. */
  autoCompactWindow?: number
  skills?: string[]
  initialPrompt?: string
  memory?: 'user' | 'project' | 'local'
  background?: boolean
  omitClaudeMd?: boolean
  isolation?: 'worktree' | 'remote'
  observer?: string
  observerMessage?: string
  observeSubagents?: boolean
}

/**
 * Typed launch options exposed by this wrapper. Grouped by concern.
 *
 * These translate 1:1 to CLI flags via `argsFromOptions()` — if you add a
 * field here, add the mapping there and a unit test covering it.
 */
export interface QueryOptions {
  /** Native hook callbacks registered during initialization. */
  hooks?: ClaudeHooks
  // Turn content — string for text-only, UserInputMessage for text + images
  prompt?: string | UserInputMessage

  // Runtime
  cwd?: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  cliPath?: string

  // Model / behaviour
  model?: string
  /** Offer account models not yet recognized by the pinned native runtime. Explicit opt-in. */
  includeUnsupportedModels?: boolean
  fallbackModel?: string
  effort?: Effort
  thinking?: Thinking
  maxThinkingTokens?: number
  maxTurns?: number
  maxBudgetUsd?: number
  betas?: string[]
  agent?: string
  agents?: Record<string, ClaudeInlineAgentDefinition>

  // Permissions
  permissionMode?: PermissionMode
  /** Make a later user-requested bypass switch available without starting in bypass mode. */
  allowDangerouslySkipPermissions?: boolean
  dangerouslySkipPermissions?: boolean
  allowedTools?: string[]
  disallowedTools?: string[]
  tools?: string[] | 'default'

  // System prompt
  systemPrompt?: string
  appendSystemPrompt?: string
  systemPromptFile?: string
  appendSystemPromptFile?: string

  // MCP / plugins / dirs
  mcpConfig?: string[]
  /** Explicit native channel selection; original policy and allowlist still govern admission. */
  channels?: string[]
  strictMcpConfig?: boolean
  pluginDir?: string[]
  addDir?: string[]

  // Settings
  settings?: string
  settingSources?: SettingScope[]

  // Structured output
  jsonSchema?: unknown

  // Session control
  sessionId?: string
  continue?: boolean
  resume?: string | true
  forkSession?: boolean
  /** Load only messages up to this CLI message UUID (SDK/print mode). */
  resumeSessionAt?: string
  /** Restore files to state at this user message UUID and exit. Requires resume. */
  rewindFiles?: string
  noSessionPersistence?: boolean
  /** Run in a git worktree for isolated file mutations. Optional name. */
  worktree?: string | true

  // Streaming knobs
  includePartialMessages?: boolean
  includeHookEvents?: boolean
  replayUserMessages?: boolean

  /**
   * Keep stdin open after the initial `prompt` is written so the caller can
   * drive follow-up turns via `handle.send()`. Default `false` — the CLI's
   * stream-json mode blocks waiting for more stdin input after emitting the
   * `result` line, so leaving stdin open deadlocks callers that just drain
   * events in a `for await`. If you set this, you OWN `handle.close()`.
   */
  keepStdinOpen?: boolean

  /**
   * Surface `control_request` events in the `handle.events` stream instead of
   * routing them through the `onPermissionRequest` / `onControlRequest` callbacks.
   * The consumer handles them inline in its event loop and sends responses via
   * `handle.respond(requestId, response)`. Default `false` for backwards compat.
   *
   * When `true`, the callbacks are ignored — the pump pushes control_request
   * lines into the event queue like any other event type, and the consumer is
   * responsible for sending the control_response.
   */
  surfaceControlRequests?: boolean

  // Callbacks (ignored when surfaceControlRequests is true)
  onPermissionRequest?: PermissionHandler
  onControlRequest?: ControlRequestHandler
}

// ─── Stdin messages (wrapper → CLI) ──────────────────────────────────────────

/** User message written to stdin during a stream-json conversation. */
export interface UserInputMessage {
  type: 'user'
  /** Stable native command identity for lifecycle tracking and queued-message cancellation. */
  uuid?: string
  message: {
    role: 'user'
    content: string | Array<Record<string, unknown>>
  }
  parent_tool_use_id?: string | null
  session_id?: string
}

// ─── Result facade ───────────────────────────────────────────────────────────

/** Normalised result returned from `query().result`. */
export interface QueryResult {
  sessionId: string
  text: string
  durationMs: number
  numTurns: number
  totalCostUsd: number
  usage?: Record<string, unknown>
  structuredOutput?: unknown
  permissionDenials: Array<Record<string, unknown>>
  raw: ResultLine
}
