/**
 * The control-request router.
 *
 * During a streaming conversation the CLI emits `{type:'control_request'}`
 * NDJSON lines to ask the wrapper questions — "can I use this tool?", "run
 * this hook", "ask the user via MCP elicitation". The wrapper must reply
 * with a matching `{type:'control_response'}` or the CLI will stall.
 *
 * Direction matters: control_requests flow both ways, but this router only
 * handles the **CLI → client** half. Known subtypes in that direction (from
 * the leaked source — see `src/entrypoints/sdk/controlSchemas.ts`):
 *
 *   - `can_use_tool`     — permission check for a tool invocation
 *   - `hook_callback`    — stdin-driven hook output
 *   - `mcp_message`      — raw JSON-RPC to an SDK-provided MCP server
 *   - `elicitation`      — "ask the user" request from an MCP server
 *
 * Subtypes like `initialize`, `interrupt`, `set_permission_mode`, `set_model`
 * go the other direction (client → CLI) and are never received here — the
 * wrapper sends *those* via `QueryHandle.interrupt()` etc.
 *
 * Responsibilities:
 *   - `can_use_tool` → `onPermissionRequest` hook
 *   - everything else → `onControlRequest` hook (or a "no handler" error)
 *   - share pending requests and replay completed responses by `request_id`, within bounded history
 *   - never let a handler throw crash the stream — thrown errors become
 *     `{subtype:'error'}` control_responses so the conversation continues
 */

import { createLogger } from '@apackdev/sdk/logger'
import type {
  CanUseToolRequest,
  ControlRequestHandler,
  ControlRequestLine,
  PermissionDecision,
  PermissionHandler,
} from './types.ts'
import { errorMessage } from '@apackdev/sdk/utils/pure';

const logger = createLogger('claude-code-control')

export interface ControlRouter {
  /** Dispatch one control_request line. Returns the response value to send. */
  handle(line: ControlRequestLine): Promise<unknown>
}

export interface ControlRouterOptions {
  onPermissionRequest?: PermissionHandler
  onControlRequest?: ControlRequestHandler
}

/** Recent responses are bounded by count and encoded size; pending decisions are never evicted. */
const REPLAY_LIMIT = 500
const REPLAY_BYTES = 32 * 1024 * 1024

/** A repeated request keeps the same decision, including a pending decision or an error. */
export function createControlRouter(opts: ControlRouterOptions = {}): ControlRouter {
  const pending = new Map<string, Promise<string>>()
  const completed = new Map<string, { encoded: string; bytes: number }>()
  let heldBytes = 0
  function remember(id: string, encoded: string): void {
    let bytes = Buffer.byteLength(encoded)
    // Keep an explicit refusal for an oversized replay, rather than invoking its handler again.
    if (bytes > REPLAY_BYTES) {
      encoded = JSON.stringify(error(id, 'Previous Claude control response is too large to replay'))
      bytes = Buffer.byteLength(encoded)
    }
    while (completed.size && (completed.size >= REPLAY_LIMIT || heldBytes + bytes > REPLAY_BYTES)) {
      const oldest = completed.keys().next().value!
      heldBytes -= completed.get(oldest)!.bytes
      completed.delete(oldest)
    }
    completed.set(id, { encoded, bytes })
    heldBytes += bytes
  }
  return {
    async handle(line: ControlRequestLine): Promise<unknown> {
      const id = line.request_id
      const previous = completed.get(id)
      if (previous) return JSON.parse(previous.encoded)
      const active = pending.get(id)
      if (active) return JSON.parse(await active)
      if (pending.size >= REPLAY_LIMIT) return error(id, 'Too many pending Claude control requests')
      let complete!: (encoded: string) => void
      pending.set(id, new Promise(resolve => { complete = resolve }))
      try {
        let encoded: string
        try {
          encoded = JSON.stringify(success(id, await dispatch(line.request.subtype, line.request, opts)))
        } catch (err) {
          encoded = JSON.stringify(error(id, errorMessage(err)))
        }
        remember(id, encoded)
        complete(encoded)
        return JSON.parse(encoded)
      } finally {
        pending.delete(id)
      }
    },
  }
}

async function dispatch(
  subtype: string,
  request: ControlRequestLine['request'],
  opts: ControlRouterOptions,
): Promise<unknown> {
  if (subtype === 'can_use_tool') {
    const req = request as unknown as CanUseToolRequest
    if (!req.tool_name || !req.tool_use_id) {
      logger.warn('malformed can_use_tool request — missing tool_name or tool_use_id', { request })
      return { behavior: 'deny', message: 'Malformed request: missing tool_name or tool_use_id' }
    }
    logger.debug('dispatching can_use_tool', {
      tool_name: req.tool_name,
      tool_use_id: req.tool_use_id,
      hasHandler: !!opts.onPermissionRequest,
    })
    const decision: PermissionDecision = opts.onPermissionRequest
      ? await opts.onPermissionRequest(req)
      : { behavior: 'deny', message: 'No permission handler configured' }
    logger.debug('can_use_tool decision resolved', {
      tool_name: req.tool_name,
      behavior: decision.behavior,
    })
    return decision
  }

  // All other CLI → client subtypes (hook_callback, mcp_message, elicitation,
  // …) are forwarded to the generic hook so callers can extend without
  // patching this file.
  if (opts.onControlRequest) {
    logger.debug('dispatching generic control_request', { subtype })
    return await opts.onControlRequest(request as { subtype: string } & Record<string, unknown>)
  }
  logger.warn('unhandled control_request subtype', { subtype })
  throw new Error(`unhandled control_request subtype "${subtype}"`)
}

// ─── Response shaping ────────────────────────────────────────────────────────

function success(requestId: string, response: unknown): object {
  return {
    type: 'control_response',
    response: { subtype: 'success', request_id: requestId, response },
  }
}

function error(requestId: string, message: string): object {
  return {
    type: 'control_response',
    response: { subtype: 'error', request_id: requestId, error: message },
  }
}
