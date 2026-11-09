/**
 * Claude Code CLI wrapper — public entry point.
 *
 * This module is a hand-rolled subprocess wrapper around the `claude` binary.
 * It keeps Claude Code the driver of the actual conversation (TOS-safe) while
 * exposing a clean, typed Node API to the rest of apack.
 *
 * Shape:
 *   import { claudeCode } from '@apackdev/sdk/services'
 *
 *   // Streaming conversation
 *   const conv = await claudeCode.query({ cwd, prompt: 'hi' })
 *   for await (const ev of conv.events) console.log(ev.type)
 *   const result = await conv.result
 *
 *   // Subcommand namespaces
 *   await claudeCode.system.version()
 *   await claudeCode.auth.status()
 *   await claudeCode.mcp.list()
 *   await claudeCode.sessions.list({ cwd })
 *
 * `createClaudeCode(ctx)` lets you bind a cwd / env / cliPath once and reuse
 * it across calls. `claudeCode` is a default instance bound to no cwd —
 * callers must pass cwd explicitly to `query()` and to subcommands that
 * need one.
 */

import { query as queryRaw, type QueryHandle } from './query.ts'
import { execOnce, spawnStream } from './runner.ts'
import type { QueryOptions } from './types.ts'

import * as sessions from './sessions.ts'
import * as mcp from './mcp.ts'
import * as plugins from './plugins.ts'
import * as agents from './agents.ts'
import * as auth from './auth.ts'
import * as system from './system.ts'

// ─── Re-exports ──────────────────────────────────────────────────────────────

export * from './types.ts'
export * from './errors.ts'
export type { AuthStatus } from './auth.ts'
export type { McpServerInfo } from './mcp.ts'
export type { PluginInfo, MarketplaceInfo } from './plugins.ts'
export type { SessionInfo, SessionListOptions, SessionTranscriptEntry, SessionViewOptions } from './sessions.ts'
export { decodeNdjson, encodeNdjsonLine } from './ndjson.ts'
export { argsFromOptions } from './args.ts'
export { execOnce, spawnStream } from './runner.ts'
export { query } from './query.ts'
export type { QueryHandle }
export { sessions, mcp, plugins, agents, auth, system }

// ─── Instance factory ────────────────────────────────────────────────────────

export interface ClaudeCodeContext {
  /** Default working directory for `query()` and subcommands. */
  cwd?: string
  /** Default process environment (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv
  /** Override the resolved CLI path (skips path resolution). */
  cliPath?: string
}

export interface ClaudeCode {
  query(opts: QueryOptions): Promise<QueryHandle>
  sessions: typeof sessions
  mcp: typeof mcp
  plugins: typeof plugins
  agents: typeof agents
  auth: typeof auth
  system: typeof system
  /** Low-level escape hatch — run any argv you like against the binary. */
  exec: typeof execOnce
  /** Low-level escape hatch — start a long-lived streaming child. */
  spawn: typeof spawnStream
}

/**
 * Bind a default context (cwd / env / cliPath) and return a `ClaudeCode`
 * instance. Per-call options on `query()` override the context.
 */
function createClaudeCode(ctx: ClaudeCodeContext = {}): ClaudeCode {
  return {
    query: opts => queryRaw({
      cwd: ctx.cwd,
      env: ctx.env,
      cliPath: ctx.cliPath,
      ...opts,
    }),
    sessions,
    mcp,
    plugins,
    agents,
    auth,
    system,
    exec: execOnce,
    spawn: spawnStream,
  }
}

/**
 * Default singleton. No cwd is bound — callers must provide one when calling
 * `query()` or any subcommand that needs a working directory.
 */
export const claudeCode: ClaudeCode = createClaudeCode()
