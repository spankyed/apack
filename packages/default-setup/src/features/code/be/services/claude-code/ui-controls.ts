import { claudeSettingsSnapshot, claudeSettingsOperation, type ClaudeSettingsOperation } from '../../../common/native-settings.ts'
import type { ClaudePrintClientProjection } from './print-client-bridge.ts'
import { z } from 'zod'
import type { ClaudePromptHost, createClaudePromptHosts } from './ui-prompt-host.ts'
import { ClaudeProtocolError } from './errors.ts'
import { CLAUDE_UI_TEXT_LIMIT_MESSAGE, CLAUDE_UI_TEXT_MAX_LENGTH } from './ui-text-limits.ts'
import type { ClaudeInitialization, createHostControls } from './host-controls.ts'

const clientPointer = z.object({kind:z.literal('pointer'),type:z.enum(['down','move','up','enter','leave']),x:z.number().int().min(-1000000).max(1000000),y:z.number().int().min(-1000000).max(1000000),fine:z.object({x:z.number().finite().min(-1000000).max(1000000),y:z.number().finite().min(-1000000).max(1000000)}).strict().optional(),button:z.enum(['left','middle','right']).optional(),ctrl:z.literal(true).optional(),shift:z.literal(true).optional(),alt:z.literal(true).optional()}).strict()
const clientInput = z.discriminatedUnion('kind',[
 z.object({kind:z.literal('resize'),columns:z.number().int().min(0).max(100000),rows:z.number().int().min(0).max(100000)}).strict(),
 z.object({kind:z.literal('key'),key:z.string().min(1).max(32).refine(key=>key!=='escape'),ctrl:z.literal(true).optional(),shift:z.literal(true).optional(),meta:z.literal(true).optional()}).strict(),clientPointer,
]) satisfies z.ZodType<ClaudeUiClientInput>
export type ClaudeUiClientInput =
  | {
    kind: 'resize'
    columns: number
    rows: number
  }
  | {
    kind: 'key'
    key: string
    ctrl?: true
    shift?: true
    meta?: true
  }
  | {
    kind: 'pointer'
    type: 'down' | 'move' | 'up' | 'enter' | 'leave'
    x: number
    y: number
    fine?: {
      x: number
      y: number
    }
    button?: 'left' | 'right' | 'middle'
    ctrl?: true
    shift?: true
    alt?: true
  }
// Parsed native binding data, not keybinding strings or native callback handles.
const actionStroke = z.object({ key: z.string(), ctrl: z.boolean(), alt: z.boolean(), shift: z.boolean(), meta: z.boolean(), super: z.boolean() }).strict()
const actionKeys = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/), bindings: z.array(z.array(actionStroke)), continuations: z.array(z.array(actionStroke)), pending: z.array(actionStroke).nullable() }).strict() satisfies z.ZodType<ClaudeUiActionKeyState>
const actionKeyEvent = z.object({ key: z.string().min(1).max(32), ctrl: z.boolean(), alt: z.boolean(), shift: z.boolean(), super: z.boolean(), from_composer: z.boolean() }).strict()
const actionKeyRequest = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/), event: actionKeyEvent }).strict() satisfies z.ZodType<ClaudeUiActionKeyRequest>
type ClaudeUiActionStroke = {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  super: boolean
}
export type ClaudeUiActionKeyState = {
  revision: string
  bindings: ClaudeUiActionStroke[][]
  continuations: ClaudeUiActionStroke[][]
  pending: ClaudeUiActionStroke[] | null
}
export type ClaudeUiActionKeyRequest = {
  revision: string
  event: {
    key: string
    ctrl: boolean
    alt: boolean
    shift: boolean
    super: boolean
    from_composer: boolean
  }
}
export function readClaudeUiActionKeys(value: unknown): ClaudeUiActionKeyState | undefined {
  const parsed = actionKeys.safeParse(value)
  return parsed.success ? parsed.data : undefined
}
const managedSettingsDiagnostic=z.object({file:z.string().max(4096),path:z.string().max(4096),message:z.string().max(32768),severity:z.enum(['warning','fatal']).optional(),errorClass:z.string().max(128).optional(),errno:z.string().max(128).optional(),statusOnly:z.boolean().optional(),userWritable:z.boolean().optional()}).strict() satisfies z.ZodType<ClaudeManagedSettingsDiagnostic>
export type ClaudeManagedSettingsDiagnostic = {
  file: string
  path: string
  message: string
  severity?: 'warning' | 'fatal'
  errorClass?: string
  errno?: string
  statusOnly?: boolean
  userWritable?: boolean
}
const diagnosticAttachment = z.object({id:z.string().min(1).max(256),revision:z.string().regex(/^[a-f0-9]{64}$/),anchorIds:z.array(z.string().min(1).max(256)).max(256),summary:z.string().max(65536),detail:z.string().max(65536)}).strict() satisfies z.ZodType<ClaudeUiDiagnosticAttachment>
export type ClaudeUiDiagnosticAttachment = {
  id: string
  revision: string
  anchorIds: string[]
  summary: string
  detail: string
}
const toolGroup = z.object({id:z.string().min(1).max(256),anchorIds:z.array(z.string().min(1).max(256)).max(256),members:z.array(z.object({toolUseId:z.string().min(1).max(256),revision:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(256),usesEngine:z.boolean(),isActive:z.boolean(),isExpanded:z.boolean(),initialized:z.boolean(),revision:z.string().regex(/^[a-f0-9]{64}$/)}).strict() satisfies z.ZodType<ClaudeUiToolGroup>
export type ClaudeUiToolGroup = {
  id: string
  anchorIds: string[]
  members: {
    toolUseId: string
    revision: string
  }[]
  usesEngine: boolean
  isActive: boolean
  isExpanded: boolean
  initialized: boolean
  revision: string
}
const composerPlacement=z.object({component:z.enum(['Spinner','SessionMode','PromptHint']),id:z.string().min(1).max(256),revision:z.string().regex(/^[a-f0-9]{64}$/)}).strict() satisfies z.ZodType<ClaudeUiComposerPlacement>
export type ClaudeUiComposerPlacement = {
  component: 'Spinner' | 'SessionMode' | 'PromptHint'
  id: string
  revision: string
}
const terminalPlacement=z.object({component:z.enum(['TurnDuration','InfoNotice']),id:z.string().min(1).max(256),revision:z.string().regex(/^[a-f0-9]{64}$/),anchorIds:z.array(z.string().min(1).max(256)).max(256)}).strict() satisfies z.ZodType<ClaudeUiTerminalPlacement>
export type ClaudeUiTerminalPlacement = {
  component: 'TurnDuration' | 'InfoNotice'
  id: string
  revision: string
  anchorIds: string[]
}
const transcriptTimestamp = z.object({
  uuid: z.string().min(1).max(256),
  datetime: z.iso.datetime(),
  label: z.string().min(1).max(256),
}).strict() satisfies z.ZodType<ClaudeTranscriptTimestamp>
export type ClaudeTranscriptTimestamp = {
  uuid: string
  datetime: string
  label: string
}
const clientId = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)
const surface = z.enum(['desktop', 'mobile', 'vscode'])
const surfaces = z.array(z.enum(['terminal', 'desktop', 'mobile', 'vscode']))
const viewport = z.object({ columns: z.number().int().positive(), rows: z.number().int().positive(), isFullscreen: z.boolean().optional() }).strict()
const nativeView = z.object({ session_id: z.string().min(1).max(256), revision: z.number().int().positive().safe(), agent_id: z.string().min(1).max(256) }).strict()
const attach = z.object({ client_id: clientId, surface, viewport: viewport.optional(), native_view: nativeView.optional() }).strict().refine(value => !value.native_view || value.surface === 'desktop', 'native Agent UI requires desktop') satisfies z.ZodType<ClaudeUiAttach>
const instanceRevision = z.number().int().positive().safe()
const instanceRelease = z.object({ client_id: clientId, component: z.string().min(1).max(256), instance_id: z.string().min(1).max(256), instance_revision: instanceRevision }).strict() satisfies z.ZodType<ClaudeUiInstanceRelease>
type ClaudeUiInstanceRelease = {
  client_id: string
  component: string
  instance_id: string
  instance_revision: number
}
const render = z.object({ client_id: clientId, surface, component: z.string(), instance_id: z.string(), props: z.record(z.string(), z.unknown()), instance_revision: instanceRevision.optional(), viewport: viewport.optional() }).strict() satisfies z.ZodType<ClaudeUiRender>
const press = z.object({ client_id: clientId, surface, plugin: z.string(), handle: z.number().int().safe(), key: z.string().optional(), href: z.string().max(2048).optional(), component: z.string().optional(), instance_id: z.string().max(256).optional(), instance_revision: instanceRevision.optional() }).strict() satisfies z.ZodType<ClaudeUiPress>
// Frozen 2.1.302 ui_input/ui_select schemas: whole-field text, keyed redraw identity.
const field = z.object({
  client_id: clientId, surface, plugin: z.string().max(256), handle: z.number().int().safe(),
  key: z.string().optional(), component: z.string().optional(), instance_id: z.string().max(256).optional(), instance_revision: instanceRevision.optional(),
  value: z.string().max(16384),
}).strict() satisfies z.ZodType<ClaudeUiSelect>
const input = field.extend({ kind: z.enum(['change', 'submit']) }) satisfies z.ZodType<ClaudeUiInput>
const fieldResult = z.object({ handled: z.boolean(), element: z.string().optional(), value: z.string().optional() }).passthrough()
// Absent element reports hold only; null selects the site container (native 2.1.302).
const scroll = z.object({ client_id: clientId, surface, component: z.enum(['Pane', 'AbovePrompt']), instance_id: z.string().max(256),
  offset: z.number().int().nonnegative(), by: z.number().int(), body_rows: z.number().int().nonnegative(), content_rows: z.number().int().nonnegative(),
  pointer: z.object({ column: z.number().int(), row: z.number().int() }).strict().optional(),
  keyed: z.array(z.object({ plugin: z.string().max(256), key: z.string().max(256), top: z.number().int().nonnegative(), bottom: z.number().int().nonnegative() }).strict()).max(512).optional(),
}).strict() satisfies z.ZodType<ClaudeUiScroll>
const scrollResult = z.object({ moved: z.boolean(), offset: z.number().int(), deny: z.string().optional(), follow_end: z.boolean().optional() }).passthrough()
export type ClaudeUiScroll = {
  client_id: string
  surface: 'desktop' | 'mobile' | 'vscode'
  component: 'Pane' | 'AbovePrompt'
  instance_id: string
  offset: number
  by: number
  body_rows: number
  content_rows: number
  pointer?: {
    column: number
    row: number
  }
  keyed?: {
    plugin: string
    key: string
    top: number
    bottom: number
  }[]
}

const focusElement = z.object({ plugin: z.string().max(256), key: z.string().max(256) }).strict()
const focus = z.object({ client_id: clientId, surface, component: z.enum(['Pane', 'AbovePrompt']),
  instance_id: z.string().max(256), is_held: z.boolean(), element: focusElement.nullable().optional(),
  by: z.enum(['person', 'auto']),
}).strict() satisfies z.ZodType<ClaudeUiFocus>
const focusResult = z.object({ moved: z.boolean(), element: focusElement.nullable(), deny: z.string().optional() }).passthrough() satisfies z.ZodType<ClaudeUiFocusResult>
const promptKey = z.object({ key: z.string().min(1).max(32), ctrl: z.literal(true).optional(), shift: z.literal(true).optional(), meta: z.literal(true).optional() }).strict()
const promptEdit = z.object({ client_id: clientId, surface, text: z.string().max(1000000), cursor: z.number().int().nonnegative().safe(),
  by: z.enum(['person', 'app']), key: promptKey.optional(),
}).strict().refine(value => value.by !== 'app' || value.key === undefined, 'programmatic draft adoption carries no key') satisfies z.ZodType<ClaudeUiPromptEdit>
const templateOfferId = z.string().uuid().optional()
const promptAutocomplete = z.object({ client_id: clientId, surface, text: z.string().max(1000000), cursor: z.number().int().nonnegative().safe(), templateOfferId }).strict() satisfies z.ZodType<ClaudeUiPromptAutocomplete>
const promptCompletions = z.object({ suggestions: z.array(z.object({ text: z.string().min(1), label: z.string().optional(), description: z.string().optional(), templateOfferId, replacement: z.object({ start: z.number().int().nonnegative().safe(), end: z.number().int().nonnegative().safe() }).strict().optional() }).passthrough()),
  start: z.number().int().nonnegative().optional(), superseded: z.literal(true).optional(),
}).passthrough() satisfies z.ZodType<ClaudeUiPromptCompletions>
const promptDecoration = z.object({ start: z.number().int().nonnegative(), end: z.number().int(), color: z.string().optional(), backgroundColor: z.string().optional(),
  dimColor: z.boolean().optional(), bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), strikethrough: z.boolean().optional(),
  virtualText: z.string().optional(),
}).passthrough()
const promptFrame = z.object({ text: z.string().max(1000000), cursor: z.number().int().nonnegative(),
  decorations: z.array(promptDecoration).max(8192).optional(), superseded: z.literal(true).optional(),
}).passthrough().superRefine((frame, context) => {
  if (frame.cursor > frame.text.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'native prompt cursor exceeds text' })
  let lastStart = 0, paintEnd = 0
  for (const run of frame.decorations ?? []) {
    const virtual = run.start === run.end
    if (run.start < lastStart || run.end < run.start || run.end > frame.text.length
      || (virtual ? !run.virtualText : run.start < paintEnd || run.virtualText !== undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'native prompt decoration range is invalid' })
    }
    lastStart = run.start
    if (!virtual) paintEnd = run.end
  }
}) satisfies z.ZodType<ClaudeUiPromptFrame>
// Frozen 2.1.302 pane roster and person-origin pane controls.
const paneId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const pane = z.object({ id: paneId, title: z.string(), plugin: z.string(), close_on_escape: z.literal(true).optional(),
  hold_toasts: z.literal(true).optional(), rows: z.number().int().optional(), columns: z.number().int().optional(),
}).passthrough()
const paneRoster = z.object({ panes: z.array(pane), shown_id: paneId.nullable(), focused_id: paneId.nullable(), focus_requested_id: paneId.nullable(), _apack_action_keys: actionKeys.optional() }).passthrough() satisfies z.ZodType<ClaudeUiPaneRoster>
const paneSelection = z.object({ client_id: clientId, surface, id: paneId }).strict() satisfies z.ZodType<ClaudeUiPaneSelection>
type ClaudeUiPaneSelection = {
  client_id: string
  surface: 'desktop' | 'mobile' | 'vscode'
  id: string
}
export type ClaudeUiPaneRoster = {
  [x: string]: unknown
  panes: {
    [x: string]: unknown
    id: string
    title: string
    plugin: string
    close_on_escape?: true
    hold_toasts?: true
    rows?: number
    columns?: number
  }[]
  shown_id: string | null
  focused_id: string | null
  focus_requested_id: string | null
  _apack_action_keys?: {
    revision: string
    bindings: {
      key: string
      ctrl: boolean
      alt: boolean
      shift: boolean
      meta: boolean
      super: boolean
    }[][]
    continuations: {
      key: string
      ctrl: boolean
      alt: boolean
      shift: boolean
      meta: boolean
      super: boolean
    }[][]
    pending: {
      key: string
      ctrl: boolean
      alt: boolean
      shift: boolean
      meta: boolean
      super: boolean
    }[] | null
  }
}

const ideContext = z.object({text:z.string().min(1).max(256),revision:z.string().regex(/^[a-f0-9]{64}$/)}).strict() satisfies z.ZodType<ClaudeUiIdeContext>
export type ClaudeUiIdeContext = {
  text: string
  revision: string
}
const renderResult = z.object({ _apack_ide:ideContext.optional().catch(undefined), _apack_action_keys: actionKeys.optional().catch(undefined), native_hint:z.boolean().optional(), idle_return_hint:z.string().min(1).max(256).optional(), idle_task_output:z.string().min(1).max(65536).optional(), group_engine:z.boolean().optional(), tree: z.unknown(), props: z.record(z.string(), z.unknown()), rewritten: z.boolean(), hooked: z.boolean(), output_rewritten: z.boolean().optional(), output_in_native_process:z.boolean().optional(), engine_output: z.string().max(65536).optional(), drawn_by: z.array(z.string()).optional(), client_modules: z.record(z.string(), z.string()).optional() }).passthrough().refine(value => value.tree !== undefined, 'native UI response must contain a tree') satisfies z.ZodType<ClaudeUiRenderResult>

export type ClaudeUiAttach = {
  client_id: string
  surface: 'desktop' | 'mobile' | 'vscode'
  viewport?: {
    columns: number
    rows: number
    isFullscreen?: boolean
  }
  native_view?: {
    session_id: string
    revision: number
    agent_id: string
  }
}
export type ClaudeUiRender = {
  client_id: string
  surface: 'desktop' | 'mobile' | 'vscode'
  component: string
  instance_id: string
  props: Record<string, unknown>
  instance_revision?: number
  viewport?: {
    columns: number
    rows: number
    isFullscreen?: boolean
  }
}
export type ClaudeUiPress = {
  client_id: string
  surface: 'desktop' | 'mobile' | 'vscode'
  plugin: string
  handle: number
  key?: string
  href?: string
  component?: string
  instance_id?: string
  instance_revision?: number
}
export type ClaudeUiFocus = {
  client_id: string
  surface: 'desktop' | 'mobile' | 'vscode'
  component: 'Pane' | 'AbovePrompt'
  instance_id: string
  is_held: boolean
  by: 'person' | 'auto'
  element?: {
    plugin: string
    key: string
  } | null
}
export type ClaudeUiFocusResult = {
  [x: string]: unknown
  moved: boolean
  element: {
    plugin: string
    key: string
  } | null
  deny?: string
}
export type ClaudeUiInput = {
  client_id: string
  surface: 'desktop' | 'mobile' | 'vscode'
  plugin: string
  handle: number
  value: string
  kind: 'change' | 'submit'
  key?: string
  component?: string
  instance_id?: string
  instance_revision?: number
}
export type ClaudeUiSelect = {
  client_id: string
  surface: 'desktop' | 'mobile' | 'vscode'
  plugin: string
  handle: number
  value: string
  key?: string
  component?: string
  instance_id?: string
  instance_revision?: number
}
export type ClaudeUiPromptEdit = {
  client_id: string
  surface: 'desktop' | 'mobile' | 'vscode'
  text: string
  cursor: number
  by: 'person' | 'app'
  key?: {
    key: string
    ctrl?: true
    shift?: true
    meta?: true
  }
}
export type ClaudeUiPromptAutocomplete = {
  client_id: string
  surface: 'desktop' | 'mobile' | 'vscode'
  text: string
  cursor: number
  templateOfferId?: string
}
export type ClaudeUiPromptCompletions = {
  [x: string]: unknown
  suggestions: {
    [x: string]: unknown
    text: string
    label?: string
    description?: string
    templateOfferId?: string
    replacement?: {
      start: number
      end: number
    }
  }[]
  start?: number
  superseded?: true
}
export type ClaudeUiPromptFrame = {
  [x: string]: unknown
  text: string
  cursor: number
  decorations?: {
    [x: string]: unknown
    start: number
    end: number
    color?: string
    backgroundColor?: string
    dimColor?: boolean
    bold?: boolean
    italic?: boolean
    underline?: boolean
    strikethrough?: boolean
    virtualText?: string
  }[]
  superseded?: true
}
export type ClaudeUiRenderResult = {
  [x: string]: unknown
  tree: unknown
  props: Record<string, unknown>
  rewritten: boolean
  hooked: boolean
  _apack_ide?: ClaudeUiIdeContext
  _apack_action_keys?: ClaudeUiActionKeyState
  native_hint?: boolean
  idle_return_hint?: string
  idle_task_output?: string
  group_engine?: boolean
  output_rewritten?: boolean
  output_in_native_process?: boolean
  engine_output?: string
  drawn_by?: string[]
  client_modules?: Record<string, string>
}

const parentCommandResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('direct_message'), recipient: z.string().min(1).max(256).regex(/^[\w-]+$/u) }).strict(),
  z.object({ kind: z.literal('not_command') }).strict(),
  z.object({ kind: z.literal('review'), text: z.string().max(32768), removed: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('panel'), id: z.string().uuid(), commandName: z.string().max(256) }).strict(),
  z.object({ kind: z.literal('command_output'), messageId: z.string().uuid(), commandName: z.string().max(256), text: z.string().min(1).max(65536), isErrored: z.boolean(), outcome: z.string().max(128).optional() }).strict(),
  z.object({ kind: z.literal('blocked'), message: z.string().max(16384) }).strict(),
  z.object({ kind: z.literal('confirmation'), id: z.string().uuid(), title: z.string().max(16384), confirmLabel: z.string().max(16384), commandName: z.string().max(256).optional() }).strict(),
  z.object({ kind: z.literal('ultraplan_settled'), draft: z.string().min(1).max(32768).optional() }).strict(),
  z.object({ kind: z.literal('command_complete'), commandName: z.string().max(256), messageId: z.string().uuid(), boundaryId: z.string().uuid().optional(), sessionId: z.string().uuid().optional(), conversationId: z.string().uuid().optional() }).strict(),
]) satisfies z.ZodType<ClaudeParentCommandResult>
export type ClaudeParentCommandResult =
  | {
    kind: 'direct_message'
    recipient: string
  }
  | {
    kind: 'not_command'
  }
  | {
    kind: 'review'
    text: string
    removed: number
  }
  | {
    kind: 'panel'
    id: string
    commandName: string
  }
  | {
    kind: 'command_output'
    messageId: string
    commandName: string
    text: string
    isErrored: boolean
    outcome?: string
  }
  | {
    kind: 'blocked'
    message: string
  }
  | {
    kind: 'confirmation'
    id: string
    title: string
    confirmLabel: string
    commandName?: string
  }
  | {
    kind: 'ultraplan_settled'
    draft?: string
  }
  | {
    kind: 'command_complete'
    commandName: string
    messageId: string
    boundaryId?: string
    sessionId?: string
    conversationId?: string
  }

/** Native UI transport only. A renderer must validate tree nodes before displaying them. */
export function createClaudeUiControls(initialized: () => Promise<Pick<ClaudeInitialization, 'capabilities'>>, controls: Pick<ReturnType<typeof createHostControls>, 'request'>, promptHosts?: Pick<ReturnType<typeof createClaudePromptHosts>, 'register' | 'answers' | 'detach'>, printClients?: ClaudePrintClientProjection) {
  async function admit() { if (!(await initialized()).capabilities?.includes('ui_surface_v1')) throw new ClaudeProtocolError('native UI surface capability is unavailable') }
  async function request(value: Record<string, unknown> & { subtype: string }): Promise<unknown> {
    const metadata = await initialized()
    if (!metadata.capabilities?.includes('ui_surface_v1')) throw new ClaudeProtocolError('native UI surface capability is unavailable')
    // The original print transport does not implement the desktop adapter's instance lifetimes.
    if (!metadata.capabilities?.includes('apack_ui_instance_lifetime_v1')) {
      const { instance_revision: _revision, ...original } = value
      if (value.subtype === 'ui_press') { const { component: _component, instance_id: _instance, ...press } = original; return controls.request(press) }
      return controls.request(original)
    }
    return controls.request(value)
  }
  return {
    async transcriptTimestamps(id: string): Promise<ClaudeTranscriptTimestamp[]> {
      if (!(await initialized()).capabilities?.includes('apack_ui_instance_lifetime_v1')) return []
      return z.object({ timestamps: z.array(transcriptTimestamp).max(512) }).strict()
        .parse(await request({ subtype: 'apack_ui_terminal_timestamps', client_id: clientId.parse(id) })).timestamps
    },
    async terminalPlacements(id: string): Promise<ClaudeUiTerminalPlacement[]> {
      if (!(await initialized()).capabilities?.includes('apack_ui_instance_lifetime_v1')) return []
      return z.object({placements:z.array(terminalPlacement).max(128)}).strict().parse(await request({subtype:'apack_ui_terminal_placements',client_id:clientId.parse(id)})).placements
    },
    async composerPlacements(id: string): Promise<ClaudeUiComposerPlacement[]> {
      if (!(await initialized()).capabilities?.includes('apack_ui_instance_lifetime_v1')) return []
      return z.object({placements:z.array(composerPlacement).max(32)}).strict().parse(await request({subtype:'apack_ui_composer',client_id:clientId.parse(id)})).placements
    },
    async managedSettingsDiagnostics(id:string):Promise<ClaudeManagedSettingsDiagnostic[]> {
      const valid=clientId.parse(id)
      if(printClients){await admit();return z.array(managedSettingsDiagnostic).max(256).parse(await printClients.managedSettingsDiagnostics(valid))}
      if (!(await initialized()).capabilities?.includes('apack_ui_instance_lifetime_v1')) return []
      return z.object({diagnostics:z.array(managedSettingsDiagnostic).max(256)}).strict().parse(await request({subtype:'apack_ui_managed_settings_diagnostics',client_id:valid})).diagnostics
    },
    async diagnostics(id: string, columns?: number): Promise<ClaudeUiDiagnosticAttachment[]> {
      const valid=clientId.parse(id),width=z.number().int().min(20).max(240).optional().parse(columns)
      if (!(await initialized()).capabilities?.includes('apack_ui_instance_lifetime_v1')) return []
      return z.object({diagnostics:z.array(diagnosticAttachment).max(32)}).strict().parse(await request({subtype:'apack_ui_diagnostics',client_id:valid,...(width===undefined?{}:{columns:width})})).diagnostics
    },
    async toolGroups(id: string): Promise<ClaudeUiToolGroup[]> {
      const valid=clientId.parse(id)
      if (!(await initialized()).capabilities?.includes('apack_ui_instance_lifetime_v1')) return []
      return z.object({groups:z.array(toolGroup).max(256)}).strict().parse(await request({subtype:'apack_ui_tool_groups',client_id:valid})).groups
    },
    async releaseInstance(options: ClaudeUiInstanceRelease) {
      const valid = instanceRelease.parse(options)
      if (printClients) return printClients.release(valid)
      if (!(await initialized()).capabilities?.includes('apack_ui_instance_lifetime_v1')) return { released: false }
      return z.object({ released: z.boolean() }).parse(await request({ subtype: 'apack_ui_release_instance', ...valid }))
    },
    async prepareParentCommand(options: { client_id: string; text: string }) {
      const valid = z.object({ client_id: clientId, text: z.string().min(1).max(CLAUDE_UI_TEXT_MAX_LENGTH) }).strict().parse(options)
      return z.union([z.object({ kind: z.literal('prepared'), id: z.string().uuid() }).strict(), parentCommandResult]).parse(await request({ subtype: 'apack_ui_parent_command', operation: 'prepare', ...valid }))
    },
    async startParentCommand(options: { client_id: string; command_id: string }) {
      const valid = z.object({ client_id: clientId, command_id: z.string().uuid() }).strict().parse(options)
      return z.object({ kind: z.literal('running'), id: z.string().uuid() }).strict().parse(await request({ subtype: 'apack_ui_parent_command', operation: 'start', ...valid }))
    },
    async readParentCommand(options: { client_id: string; command_id: string }) {
      const valid = z.object({ client_id: clientId, command_id: z.string().uuid() }).strict().parse(options)
      return z.discriminatedUnion('kind', [
        z.object({ kind: z.enum(['prepared', 'running']), id: z.string().uuid() }).strict(),
        z.object({ kind: z.literal('finished'), id: z.string().uuid(), result: parentCommandResult }).strict(),
        z.object({ kind: z.literal('failed'), id: z.string().uuid(), message: z.string() }).strict(),
      ]).parse(await request({ subtype: 'apack_ui_parent_command', operation: 'read', ...valid }))
    },
    async submitAgent(options: { client_id: string; text: string }) {
      const valid = z.object({ client_id: clientId, text: z.string().min(1).max(CLAUDE_UI_TEXT_MAX_LENGTH).refine(text => !!text.trim()) }).strict().parse(options)
      if (!(await initialized()).capabilities?.includes('apack_native_view_v1')) throw new ClaudeProtocolError('native Agent UI attachment capability is unavailable')
      return z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('input'), messageId: z.string().uuid(), previousStatus: z.string().max(64) }).strict(),
        z.object({ kind: z.literal('review'), text: z.string().max(CLAUDE_UI_TEXT_MAX_LENGTH), removed: z.number().int().positive() }).strict(),
        z.object({ kind: z.literal('panel'), id: z.string().uuid(), commandName: z.string().max(256) }).strict(),
        z.object({ kind: z.literal('command_output'), messageId: z.string().uuid(), commandName: z.string().max(256), text: z.string().min(1).max(65536), isErrored: z.boolean(), outcome: z.string().max(128).optional() }).strict(),
        z.object({ kind: z.literal('blocked'), message: z.string().max(16384) }).strict(),
        z.object({ kind: z.literal('confirmation'), id: z.string().uuid(), title: z.string().max(16384), confirmLabel: z.string().max(16384), commandName: z.string().max(256).optional() }).strict(),
      ]).parse(await request({ subtype: 'apack_ui_agent_dispatch', ...valid }))
    },
    async agentsGesture(options: { client_id: string; sequence: number }) {
      const valid = z.object({ client_id: clientId, sequence: z.number().int().positive().safe() }).strict().parse(options)
      if (!(await initialized()).capabilities?.includes('apack_native_view_v1')) throw new ClaudeProtocolError('native agents gesture capability is unavailable')
      return z.object({ handled: z.boolean() }).strict().parse(await request({ subtype: 'apack_native_agents_gesture', ...valid }))
    },
    async backgroundReview(options: { client_id: string; panel_id: string } & ({ operation: 'read' } | { operation: 'confirm' | 'cancel'; revision: string })) {
      const identity = { client_id: clientId.parse(options.client_id), panel_id: z.string().uuid().parse(options.panel_id) }
      if (!(await initialized()).capabilities?.includes('apack_native_view_v1')) throw new ClaudeProtocolError('native background panel capability is unavailable')
      const action = options.operation === 'read' ? { operation: 'read' as const } : { operation: z.enum(['confirm', 'cancel']).parse(options.operation), revision: z.string().uuid().parse(options.revision) }
      const value = await request({ subtype: 'apack_ui_background_review', ...identity, ...action })
      if (action.operation === 'read') return z.object({ open: z.boolean(), review: z.object({ revision: z.string().uuid(), title: z.string().max(16384), paragraphs: z.array(z.string().max(32000)).max(16), confirmLabel: z.string().max(16384), cancelLabel: z.string().max(16384), defaultFocus: z.enum(['confirm', 'cancel']) }).strict().optional() }).strict().parse(value)
      return z.object({ answered: z.literal(true) }).strict().parse(value)
    },
    async settings(options: { client_id: string; panel_id: string; action: ClaudeSettingsOperation }) {
      const valid = z.object({ client_id: clientId, panel_id: z.string().uuid(), action: claudeSettingsOperation }).strict().parse(options)
      const { action, ...identity } = valid
      return z.object({ snapshot: claudeSettingsSnapshot, savedKey: z.string().optional(), problem: z.string().optional() }).strict().parse(await request({subtype:'apack_ui_settings',...identity,operation:action.kind,...(action.kind==='permissions'?{revision:action.revision,command:action.command}:{}),...(action.kind==='ideSelect'?{revision:action.revision,value:action.value}:{}),...(action.kind==='stats'?{revision:action.revision,action:action.action}:{}),...(action.kind==='tab'||action.kind==='helpTab'?{revision:action.revision,tab:action.tab}:{}),...(action.kind==='write'?{revision:action.revision,key:action.key,value:action.value}:{}),...(action.kind==='open'?{revision:action.revision,key:action.key}:{}),...(action.kind==='editor'?{revision:action.revision,editor_revision:action.editorRevision,command:action.command}:{})}))
    },
    async agentPanel(options: { client_id: string; panel_id: string } & ({ operation: 'read' | 'close' } | { operation: 'input'; text: string })) {
      const valid = z.discriminatedUnion('operation', [
        z.object({ client_id: clientId, panel_id: z.string().uuid(), operation: z.enum(['read', 'close']) }).strict(),
        z.object({ client_id: clientId, panel_id: z.string().uuid(), operation: z.literal('input'), text: z.string().min(1).max(4096) }).strict(),
      ]).parse(options)
      if (!(await initialized()).capabilities?.includes('apack_native_view_v1')) throw new ClaudeProtocolError('native Agent panel capability is unavailable')
      return z.object({ open: z.boolean() }).strict().parse(await request({ subtype: 'apack_ui_agent_panel', ...valid }))
    },
    async answerAgentCommand(options: { client_id: string; command_id: string; decision: 'confirm' | 'cancel' }) {
      const valid = z.object({ client_id: clientId, command_id: z.string().uuid(), decision: z.enum(['confirm', 'cancel']) }).strict().parse(options)
      if (!(await initialized()).capabilities?.includes('apack_native_view_v1')) throw new ClaudeProtocolError('native Agent command capability is unavailable')
      return z.object({ answered: z.literal(true) }).strict().parse(await request({ subtype: 'apack_ui_agent_command', ...valid }))
    },
    async clientEvent(options: {client_id:string;id:string;sequence:number;event:ClaudeUiClientInput}) {
      const valid=z.object({client_id:clientId,id:z.string().uuid(),sequence:z.number().int().positive().safe(),event:clientInput}).strict().parse(options)
      if (printClients) await admit()
      return z.object({handled:z.boolean()}).parse(printClients ? await printClients.event(valid) : await request({subtype:'apack_ui_client',...valid}))
    },
    /** Register only a mounted composer; registration alone does not attach or create a process. */
    servePrompt(id: string, host: ClaudePromptHost): () => void {
      if (!promptHosts) throw new ClaudeProtocolError('native composer reply transport is unavailable')
      return promptHosts.register(clientId.parse(id), host)
    },
    /** Advertise only reverse APIs the attached view can actually answer. */
    async attach(options: ClaudeUiAttach) {
      const valid = attach.parse(options)
      if (valid.native_view && !(await initialized()).capabilities?.includes('apack_native_view_v1')) throw new ClaudeProtocolError('native Agent UI attachment capability is unavailable')
      return z.object({ surfaces }).passthrough().parse(await request({ subtype: 'ui_attach', ...valid, answers: valid.surface === 'desktop' ? promptHosts?.answers(valid.client_id) ?? [] : [] }))
    },
    async detach(id: string) {
      const valid = clientId.parse(id)
      promptHosts?.detach(valid)
      if (printClients) { try { await printClients.detach(valid) } catch { /* Original roster detachment still retires native ownership. */ } }
      return z.object({ detached: z.boolean(), surfaces }).passthrough().parse(await request({ subtype: 'ui_detach', client_id: valid }))
    },
    async render(options: ClaudeUiRender): Promise<ClaudeUiRenderResult> {
      const valid = render.parse(options)
      if(valid.component==='ToolResult')await printClients?.prepareRender?.(valid)
      const frame = renderResult.parse(await request({ subtype: 'ui_render', ...valid }))
      return printClients ? renderResult.parse(await printClients.project(valid, frame)) : frame
    },
    /** Read on mount: a pane opened before stream arming produces no roster push. */
    async panes(id: string): Promise<ClaudeUiPaneRoster> {
      return paneRoster.parse(await request({ subtype: 'ui_panes', client_id: clientId.parse(id) }))
    },
    async showPane(options: ClaudeUiPaneSelection) {
      return z.object({ shown_id: paneId.nullable() }).passthrough().parse(await request({ subtype: 'ui_pane_show', ...paneSelection.parse(options) }))
    },
    /** Null returns the keyboard and settles a refused plugin focus request. */
    async focusPane(options: Omit<ClaudeUiPaneSelection, 'id'> & { id: string | null }) {
      const valid = paneSelection.extend({ id: paneId.nullable() }).parse(options)
      return z.object({ focused_id: paneId.nullable() }).passthrough().parse(await request({ subtype: 'ui_pane_focus', ...valid }))
    },
    /** Native runs ui.close with origin person; a hook may refuse, so never hide optimistically. */
    async closePane(options: { client_id: string; id: string }) {
      const valid = paneSelection.omit({ surface: true }).parse(options)
      return z.object({ closed: z.boolean() }).passthrough().parse(await request({ subtype: 'ui_close', ...valid }))
    },
    /** Native owns scroll hooks and the authoritative offset, including a denied move. */
    async scroll(options: ClaudeUiScroll) {
      return scrollResult.parse(await request({ subtype: 'ui_scroll', ...scroll.parse(options) }))
    },
    /** Hooks may redirect the ring; the mounted owner validates the returned identity before applying it. */
    async focus(options: ClaudeUiFocus): Promise<ClaudeUiFocusResult> {
      const valid = focus.parse(options)
      return focusResult.parse(await request({ subtype: 'ui_focus', ...valid }))
    },
    /** Native resolves configured keys; no terminal callback handle is accepted from the renderer. */
    async dismissIde(options: {client_id:string;revision:string}) {
      const valid=z.object({client_id:clientId,revision:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(options)
      if (!(await initialized()).capabilities?.includes('apack_native_view_v1')) throw new ClaudeProtocolError('native IDE context is unavailable')
      return z.object({handled:z.boolean()}).strict().parse(await request({subtype:'apack_ui_ide_dismiss',...valid}))
    },
    async key(options: ClaudeUiActionKeyRequest & { client_id: string }) {
      const valid = actionKeyRequest.extend({ client_id: clientId }).parse(options)
      if (!(await initialized()).capabilities?.includes('apack_native_view_v1')) throw new ClaudeProtocolError('native action keys are unavailable')
      return z.object({ handled: z.boolean(), action_keys: actionKeys }).strict().parse(await request({ subtype: 'apack_ui_action_key', ...valid }))
    },
    /** Native owns prompt.edit hooks and latest-edit coalescing; app adoption raises no edit hook. */
    async promptEdit(options: ClaudeUiPromptEdit): Promise<ClaudeUiPromptFrame> {
      if (typeof options.text === 'string' && options.text.length > CLAUDE_UI_TEXT_MAX_LENGTH) throw new ClaudeProtocolError(CLAUDE_UI_TEXT_LIMIT_MESSAGE)
      const valid = promptEdit.parse(options)
      const frame = promptFrame.parse(await request({ subtype: 'ui_prompt_edit', ...valid }))
      return frame.decorations?.length && printClients?.prompt ? promptFrame.parse({ ...frame, decorations: await printClients.prompt(valid.client_id, frame.decorations) }) : frame
    },
    /** Plugin rows follow the host's own completion rows; autocomplete never gates an edit or Send. */
    async promptAutocomplete(options: ClaudeUiPromptAutocomplete): Promise<ClaudeUiPromptCompletions> {
      const valid = promptAutocomplete.parse(options)
      const result = promptCompletions.parse(await request({ subtype: 'ui_prompt_autocomplete', ...valid }))
      const cursor = Math.min(valid.cursor, valid.text.length)
      if ((result.start !== undefined && result.start > cursor) || (result.suggestions.length && result.start === undefined)
        || result.suggestions.some(({ replacement }) => replacement && (replacement.start > cursor || replacement.end < cursor || replacement.end > valid.text.length))) {
        throw new ClaudeProtocolError('native autocomplete token range is invalid')
      }
      return result
    },
    /** Native serializes callbacks per plugin; send the whole current draft on each edit. */
    async input(options: ClaudeUiInput) {
      const valid = input.parse(options)
      let projected: unknown
      if (printClients) { await admit(); projected = await printClients.action({ subtype: 'ui_input', ...valid }) }
      return fieldResult.parse(projected ?? await request({ subtype: 'ui_input', ...valid }))
    },
    /** Native validates membership against the Select options in the current drawing. */
    async select(options: ClaudeUiSelect) {
      const valid = field.parse(options)
      let projected: unknown
      if (printClients) { await admit(); projected = await printClients.action({ subtype: 'ui_select', ...valid }) }
      return fieldResult.parse(projected ?? await request({ subtype: 'ui_select', ...valid }))
    },
    /** Forward the capability issued in the current tree; a stale handle returns handled:false. */
    async press(options: ClaudeUiPress) {
      const valid = press.parse(options)
      let projected: unknown
      if (printClients) { await admit(); projected = await printClients.action({ subtype: 'ui_press', ...valid }) }
      return z.object({ handled: z.boolean(), element: z.string().optional() }).passthrough().parse(projected ?? await request({ subtype: 'ui_press', ...valid }))
    },
  }
}

export type ClaudeUiControls = ReturnType<typeof createClaudeUiControls>
