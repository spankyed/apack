import {mkdir, writeFile, rename} from 'node:fs/promises'
import {basename, isAbsolute, join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createClaudeNativeEditorLease, type ClaudeNativeEditorOffer, type ClaudeNativeEditorScope} from './native-editor-lease.ts'
import {CLAUDE_NATIVE_EDITOR_PROGRAM} from './native-editor/program.generated.ts'
import {CLAUDE_NATIVE_EDITOR_MAX_BYTES} from '../../../common/native-editor.ts'
import type {ClaudeTerminalUiTransport} from './terminal-ui.ts'

type Request = Parameters<ClaudeTerminalUiTransport['request']>[0]
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'"
const reads = new Set(['ui_render', 'ui_panes', 'apack_ui_agent_input', 'apack_ui_composer', 'apack_ui_terminal_placements', 'apack_ui_tool_groups', 'apack_ui_diagnostics', 'apack_ui_managed_settings_diagnostics', 'apack_owner_snapshot', 'apack_parent_prompt_state', 'apack_mcp_input', 'apack_native_notice', 'apack_question_dialogs', 'apack_tool_permission_dialogs', 'apack_generic_tool_permission_dialogs', 'apack_file_dialogs', 'apack_workflow_dialogs', 'apack_agent_state', 'apack_task_details', 'apack_mcp_status', 'apack_list_models', 'apack_get_model_selection', 'apack_get_permission_mode'])

/** Desktop-only editor handoff. The original native request still owns validation and persistence. */
export async function createClaudeNativeEditorBridge(options: {
  directory: string; socketPath: string; token: string
  transport: ClaudeTerminalUiTransport
  hold(value: Request): () => void
  current(): {pid: number; sessionId: string} | undefined
  ownsChild(pid: number): Promise<boolean>
  changed(): void
  failed(scope: ClaudeNativeEditorScope, error: Error): void
}) {
  const directory = join(options.directory, 'editor'), launcher = join(directory, 'open'), program = join(directory, 'editor.mjs'), configuration = join(directory, 'editor.json')
  if (/\s/.test(launcher)) throw new Error('Native editor launcher path cannot contain whitespace')
  await mkdir(directory, {mode: 0o700})
  await writeFile(program, CLAUDE_NATIVE_EDITOR_PROGRAM, {mode: 0o600, flag: 'wx'})
  await writeFile(launcher, '#!/bin/sh\nset -eu\nELECTRON_RUN_AS_NODE=1 NODE_OPTIONS= exec ' + quote(process.execPath) + ' --max-old-space-size=128 ' + quote(program) + ' ' + quote(configuration) + ' "$@"\n', {mode: 0o700, flag: 'wx'})
  let pending: {scope: ClaudeNativeEditorScope; done: Promise<void>; resolve(): void} | undefined, closed = false, deferred = 0
  const lease = createClaudeNativeEditorLease(options)
  const isRead = (value: Request) => reads.has(value.subtype) || value.subtype === 'apack_task_control' && value.operation === 'inspect' || ['apack_ui_settings', 'apack_ui_agent_panel', 'apack_ui_background_review', 'apack_ui_parent_command'].includes(value.subtype) && value.operation === 'read'
  const same = (scope: ClaudeNativeEditorScope, value: Request) => value.client_id === scope.clientId && value.panel_id === scope.panelId
  const snapshot = () => {
    const editor = lease.active
    if (!editor) throw new Error('Native environment editor is no longer open')
    return {snapshot: {revision: editor.revision, rows: [], permissions: {title: 'Auto mode environment', tabs: [], paragraphs: [], choices: [], readOnly: false, editor: {id: editor.id, revision: editor.revision, value: editor.content, closing: editor.closing}}}}
  }
  async function wait() {
    const original = pending
    if (!original) return
    if (deferred >= 64) throw new Error('Native editor deferred-read limit reached')
    deferred++
    try {await original.done} finally {deferred--}
    if (closed) throw new Error('Native editor owner closed')
  }
  return {
    get active() {return lease.active},
    async prepare(value: {pid: number; sessionId: string; clientId: string; panelId: string; directory: string}) {
      const original = pending, owner = options.current()
      if (!original || closed || owner?.pid !== value.pid || owner.sessionId !== value.sessionId || original.scope.pid !== value.pid || original.scope.sessionId !== value.sessionId || original.scope.clientId !== value.clientId || original.scope.panelId !== value.panelId || !isAbsolute(value.directory) || basename(value.directory) !== value.sessionId || lease.active) throw new Error('Native editor preparation is not owned by the pending permission action')
      const temporary = configuration + '.' + randomUUID()
      await writeFile(temporary, JSON.stringify({socketPath: options.socketPath, token: options.token, sessionId: value.sessionId, directory: value.directory, maxBytes: CLAUDE_NATIVE_EDITOR_MAX_BYTES}), {mode: 0o600, flag: 'wx'})
      await rename(temporary, configuration)
      if (pending !== original || closed || options.current()?.pid !== value.pid || options.current()?.sessionId !== value.sessionId) throw new Error('Native editor owner changed during preparation')
      return {command: launcher}
    },
    offer(value: ClaudeNativeEditorOffer, respond: Parameters<typeof lease.offer>[1]) {return lease.offer(value, respond)},
    disconnect(id: string) {lease.disconnect(id)},
    async request(value: Request): Promise<unknown> {
      if (closed) throw new Error('Native editor owner closed')
      const command = object(value.command), editor = lease.active
      if (value.subtype === 'ui_detach' && typeof value.client_id === 'string') {lease.detach(value.client_id); await wait(); return options.transport.request(value)}
      if (editor) {
        if (value.subtype === 'apack_ui_settings' && same(editor.scope, value)) {
          if (value.operation === 'read') return snapshot()
          if (value.operation !== 'permissions' || !['externalSave', 'externalCancel'].includes(String(command?.action)) || command?.id !== editor.id || value.revision !== editor.revision) throw new Error('Native environment editor changed before this decision')
          if (command.action === 'externalSave' && (typeof command.value !== 'string' || Buffer.byteLength(command.value) > CLAUDE_NATIVE_EDITOR_MAX_BYTES)) throw new Error('Environment document exceeds the 8 MiB editor transport limit')
          return lease.finish(editor.scope, editor.revision, command.action === 'externalCancel' ? {kind: 'cancel'} : {kind: 'save', content: command.value as string})
        }
        if (!isRead(value)) throw new Error('Finish editing the environment before using other native controls')
        await wait()
        return options.transport.request(value)
      }
      if (value.subtype === 'apack_ui_settings' && value.operation === 'permissions' && ['externalSave', 'externalCancel'].includes(String(command?.action))) throw new Error('Native environment editor expired')
      const owner = options.current()
      if (owner && value.subtype === 'apack_ui_settings' && value.operation === 'permissions' && command?.action === 'select' && typeof value.client_id === 'string' && typeof value.panel_id === 'string') {
        if (pending) throw new Error('A native Permissions action is already pending')
        let resolve!: () => void
        const original = {scope: {pid: owner.pid, sessionId: owner.sessionId, clientId: value.client_id, panelId: value.panel_id}, done: new Promise<void>(yes => {resolve = yes}), resolve: () => resolve()}
        pending = original
        try {
          const result = await lease.begin(original.scope, () => options.transport.request(value).finally(() => {if (pending === original) pending = undefined; original.resolve()}), () => options.hold(value))
          return result.kind === 'native' ? result.value : snapshot()
        } catch (error) {if (pending === original) pending = undefined; original.resolve(); throw error}
      }
      try {return await options.transport.request(value)} catch (error) {
        // Reads already in flight when the synchronous native editor began may hit their ordinary timeout.
        // Wait and read afresh; never repeat a mutation or publish a deliberate wait as transport failure.
        if (lease.active && isRead(value)) {await wait(); return options.transport.request(value)}
        throw error
      }
    },
    close() {closed = true; lease.close(); pending?.resolve()},
  }
}
