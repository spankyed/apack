import { z } from 'zod'
import type { ClaudePromptHost, createClaudePromptHosts } from './ui-prompt-host.ts'
import { ClaudeProtocolError } from './errors.ts'
import type { ClaudeInitialization, createHostControls } from './host-controls.ts'

const clientId = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)
const surface = z.enum(['desktop', 'mobile', 'vscode'])
const surfaces = z.array(z.enum(['terminal', 'desktop', 'mobile', 'vscode']))
const viewport = z.object({ columns: z.number().int().positive(), rows: z.number().int().positive(), isFullscreen: z.boolean().optional() }).strict()
const attach = z.object({ client_id: clientId, surface, viewport: viewport.optional() }).strict()
const render = z.object({ client_id: clientId, surface, component: z.string(), instance_id: z.string(), props: z.record(z.unknown()), viewport: viewport.optional() }).strict()
const press = z.object({ client_id: clientId, surface, plugin: z.string(), handle: z.number().int().safe(), key: z.string().optional(), href: z.string().max(2048).optional() }).strict()
// Frozen 2.1.302 ui_input/ui_select schemas: whole-field text, keyed redraw identity.
const field = z.object({
  client_id: clientId, surface, plugin: z.string().max(256), handle: z.number().int().safe(),
  key: z.string().optional(), component: z.string().optional(), instance_id: z.string().max(256).optional(),
  value: z.string().max(16384),
}).strict()
const input = field.extend({ kind: z.enum(['change', 'submit']) })
const fieldResult = z.object({ handled: z.boolean(), element: z.string().optional(), value: z.string().optional() }).passthrough()
// Absent element reports hold only; null selects the site container (native 2.1.302).
const scroll = z.object({ client_id: clientId, surface, component: z.enum(['Pane', 'AbovePrompt']), instance_id: z.string().max(256),
  offset: z.number().int().nonnegative(), by: z.number().int(), body_rows: z.number().int().nonnegative(), content_rows: z.number().int().nonnegative(),
  pointer: z.object({ column: z.number().int(), row: z.number().int() }).strict().optional(),
  keyed: z.array(z.object({ plugin: z.string().max(256), key: z.string().max(256), top: z.number().int().nonnegative(), bottom: z.number().int().nonnegative() }).strict()).max(512).optional(),
}).strict()
const scrollResult = z.object({ moved: z.boolean(), offset: z.number().int(), deny: z.string().optional(), follow_end: z.boolean().optional() }).passthrough()
export type ClaudeUiScroll = z.infer<typeof scroll>

const focusElement = z.object({ plugin: z.string().max(256), key: z.string().max(256) }).strict()
const focus = z.object({ client_id: clientId, surface, component: z.enum(['Pane', 'AbovePrompt']),
  instance_id: z.string().max(256), is_held: z.boolean(), element: focusElement.nullable().optional(),
  by: z.enum(['person', 'auto']),
}).strict()
const focusResult = z.object({ moved: z.boolean(), element: focusElement.nullable(), deny: z.string().optional() }).passthrough()
const promptKey = z.object({ key: z.string().min(1).max(32), ctrl: z.literal(true).optional(), shift: z.literal(true).optional(), meta: z.literal(true).optional() }).strict()
const promptEdit = z.object({ client_id: clientId, surface, text: z.string().max(1000000), cursor: z.number().int().nonnegative().safe(),
  by: z.enum(['person', 'app']), key: promptKey.optional(),
}).strict().refine(value => value.by !== 'app' || value.key === undefined, 'programmatic draft adoption carries no key')
const promptAutocomplete = z.object({ client_id: clientId, surface, text: z.string().max(1000000), cursor: z.number().int().nonnegative().safe() }).strict()
const promptCompletions = z.object({ suggestions: z.array(z.object({ text: z.string().min(1), label: z.string().optional(), description: z.string().optional() }).passthrough()),
  start: z.number().int().nonnegative().optional(), superseded: z.literal(true).optional(),
}).passthrough()
const promptDecoration = z.object({ start: z.number().int().nonnegative(), end: z.number().int(), color: z.string().optional(), backgroundColor: z.string().optional(),
  dimColor: z.boolean().optional(), bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), strikethrough: z.boolean().optional(),
  virtualText: z.string().optional(),
}).passthrough()
const promptFrame = z.object({ text: z.string().max(1000000), cursor: z.number().int().nonnegative(),
  decorations: z.array(promptDecoration).max(8192).optional(), superseded: z.literal(true).optional(),
}).passthrough().superRefine((frame, context) => {
  if (frame.cursor > frame.text.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'native prompt cursor exceeds text' })
  let end = 0
  for (const run of frame.decorations ?? []) {
    if (run.start < end || run.end < run.start || run.end > frame.text.length || (run.end === run.start && !run.virtualText)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'native prompt decoration range is invalid' })
    }
    end = run.end
  }
})
// Frozen 2.1.302 pane roster and person-origin pane controls.
const paneId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const pane = z.object({ id: paneId, title: z.string(), plugin: z.string(), close_on_escape: z.literal(true).optional(),
  hold_toasts: z.literal(true).optional(), rows: z.number().int().optional(), columns: z.number().int().optional(),
}).passthrough()
const paneRoster = z.object({ panes: z.array(pane), shown_id: paneId.nullable(), focused_id: paneId.nullable(), focus_requested_id: paneId.nullable() }).passthrough()
const paneSelection = z.object({ client_id: clientId, surface, id: paneId }).strict()
export type ClaudeUiPaneRoster = z.infer<typeof paneRoster>

const renderResult = z.object({ tree: z.unknown(), props: z.record(z.unknown()), rewritten: z.boolean(), hooked: z.boolean(), drawn_by: z.array(z.string()).optional(), client_modules: z.record(z.string()).optional() }).passthrough().refine(value => value.tree !== undefined, 'native UI response must contain a tree')

export type ClaudeUiAttach = z.infer<typeof attach>
export type ClaudeUiRender = z.infer<typeof render>
export type ClaudeUiPress = z.infer<typeof press>
export type ClaudeUiFocus = z.infer<typeof focus>
export type ClaudeUiFocusResult = z.infer<typeof focusResult>
export type ClaudeUiInput = z.infer<typeof input>
export type ClaudeUiSelect = z.infer<typeof field>
export type ClaudeUiPromptEdit = z.infer<typeof promptEdit>
export type ClaudeUiPromptAutocomplete = z.infer<typeof promptAutocomplete>
export type ClaudeUiPromptCompletions = z.infer<typeof promptCompletions>
export type ClaudeUiPromptFrame = z.infer<typeof promptFrame>
export type ClaudeUiRenderResult = z.infer<typeof renderResult>

/** Native UI transport only. A renderer must validate tree nodes before displaying them. */
export function createClaudeUiControls(initialized: Promise<ClaudeInitialization>, controls: Pick<ReturnType<typeof createHostControls>, 'request'>, promptHosts?: Pick<ReturnType<typeof createClaudePromptHosts>, 'register' | 'answers' | 'detach'>) {
  async function request(value: Record<string, unknown> & { subtype: string }): Promise<unknown> {
    const metadata = await initialized
    if (!metadata.capabilities?.includes('ui_surface_v1')) throw new ClaudeProtocolError('native UI surface capability is unavailable')
    return controls.request(value)
  }
  return {
    /** Register only a mounted composer; registration alone does not attach or create a process. */
    servePrompt(id: string, host: ClaudePromptHost): () => void {
      if (!promptHosts) throw new ClaudeProtocolError('native composer reply transport is unavailable')
      return promptHosts.register(clientId.parse(id), host)
    },
    /** Advertise only reverse APIs the attached view can actually answer. */
    async attach(options: ClaudeUiAttach) {
      const valid = attach.parse(options)
      return z.object({ surfaces }).passthrough().parse(await request({ subtype: 'ui_attach', ...valid, answers: valid.surface === 'desktop' ? promptHosts?.answers(valid.client_id) ?? [] : [] }))
    },
    async detach(id: string) {
      const valid = clientId.parse(id)
      promptHosts?.detach(valid)
      return z.object({ detached: z.boolean(), surfaces }).passthrough().parse(await request({ subtype: 'ui_detach', client_id: valid }))
    },
    async render(options: ClaudeUiRender): Promise<ClaudeUiRenderResult> {
      const valid = render.parse(options)
      return renderResult.parse(await request({ subtype: 'ui_render', ...valid }))
    },
    /** Read on mount: a pane opened before stream arming produces no roster push. */
    async panes(id: string): Promise<ClaudeUiPaneRoster> {
      return paneRoster.parse(await request({ subtype: 'ui_panes', client_id: clientId.parse(id) }))
    },
    async showPane(options: z.infer<typeof paneSelection>) {
      return z.object({ shown_id: paneId.nullable() }).passthrough().parse(await request({ subtype: 'ui_pane_show', ...paneSelection.parse(options) }))
    },
    /** Null returns the keyboard and settles a refused plugin focus request. */
    async focusPane(options: Omit<z.infer<typeof paneSelection>, 'id'> & { id: string | null }) {
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
    /** Native owns prompt.edit hooks and latest-edit coalescing; app adoption raises no edit hook. */
    async promptEdit(options: ClaudeUiPromptEdit): Promise<ClaudeUiPromptFrame> {
      const valid = promptEdit.parse(options)
      return promptFrame.parse(await request({ subtype: 'ui_prompt_edit', ...valid }))
    },
    /** Plugin rows follow the host's own completion rows; autocomplete never gates an edit or Send. */
    async promptAutocomplete(options: ClaudeUiPromptAutocomplete): Promise<ClaudeUiPromptCompletions> {
      const valid = promptAutocomplete.parse(options)
      const result = promptCompletions.parse(await request({ subtype: 'ui_prompt_autocomplete', ...valid }))
      if ((result.start !== undefined && result.start > Math.min(valid.cursor, valid.text.length)) || (result.suggestions.length && result.start === undefined)) throw new ClaudeProtocolError('native autocomplete token range is invalid')
      return result
    },
    /** Native serializes callbacks per plugin; send the whole current draft on each edit. */
    async input(options: ClaudeUiInput) {
      const valid = input.parse(options)
      return fieldResult.parse(await request({ subtype: 'ui_input', ...valid }))
    },
    /** Native validates membership against the Select options in the current drawing. */
    async select(options: ClaudeUiSelect) {
      const valid = field.parse(options)
      return fieldResult.parse(await request({ subtype: 'ui_select', ...valid }))
    },
    /** Forward the capability issued in the current tree; a stale handle returns handled:false. */
    async press(options: ClaudeUiPress) {
      const valid = press.parse(options)
      return z.object({ handled: z.boolean(), element: z.string().optional() }).passthrough().parse(await request({ subtype: 'ui_press', ...valid }))
    },
  }
}

export type ClaudeUiControls = ReturnType<typeof createClaudeUiControls>
