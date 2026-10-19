import { createClaudeSiteScroll } from './ui-site-scroll.ts'
import { createClaudeUiDrawing, type ClaudeUiDrawing } from './ui-tree.ts'
import type { ClaudeUiControls, ClaudeUiPaneRoster } from './ui-controls.ts'
import type { ClaudeUiPanePresentation, ClaudeUiPaneEvent, ClaudeUiFieldEvent, ClaudeUiFocusEvent, ClaudeUiFocusReply } from './ui-presentation.ts'

/** Panes share the view's native attachment and lifetime, but never its composer callbacks. */
export function createClaudePaneHost(options: {
  ui: Pick<ClaudeUiControls, 'panes' | 'showPane' | 'focusPane' | 'closePane' | 'render' | 'press' | 'input' | 'select' | 'focus' | 'scroll'>
  client: { client_id: string; surface: 'desktop' }
  current(): boolean
  publish(): void
  requestFocus?(id: string, revision: number, paneId: string): void
}) {
  const { ui, client } = options
  let disposed = false, reading = false, rosterDirty = false, rendering = false, renderDirty = false, operating = false
  let epoch = 0, rosterEpoch = 0, focusInFlight = 0
  let refreshAfterFocus = false
  let roster: ClaudeUiPaneRoster | undefined
  let body: ClaudeUiPanePresentation['body'] = { status: 'connecting' }
  let drawing: ClaudeUiDrawing | undefined, fields: ClaudeUiDrawing | undefined
  let scheduled: ReturnType<typeof setTimeout> | undefined
  const scrolls = new Map<string, ReturnType<typeof createClaudeSiteScroll>>()
  const layouts = new Map<string, { columns: number; rows: number; offset: number }>()
  const revisions = new Map<string, number>(), completed = new Map<string, number>(), focusRevisions = new Map<string, number>()
  const current = () => !disposed && options.current()
  const publish = () => { if (current()) options.publish() }
  function siteScroll(id: string) {
    let host = scrolls.get(id)
    if (!host) {
      host = createClaudeSiteScroll({ ui, client, component: 'Pane', instanceId: id,
        current: () => current() && !!roster?.panes.some(pane => pane.id === id),
        drawing: () => roster?.shown_id === id ? drawing ?? fields : undefined,
        publish: state => {
          if (roster?.shown_id !== id) return
          const layout = layouts.get(id)
          if (layout && layout.offset !== state.offset) { layouts.set(id, { ...layout, offset: state.offset }); invalidate() }
          publish()
        },
      })
      scrolls.set(id, host)
    }
    return host
  }
  function retire() {
    drawing = undefined
    function inert(node: import('./ui-presentation.ts').ClaudeUiNode): import('./ui-presentation.ts').ClaudeUiNode {
      if (node.kind === 'button' || node.kind === 'markdown') { const { actionId: _, ...rest } = node; return rest }
      if ('children' in node && node.children) return { ...node, children: node.children.map(inert) }
      return node
    }
    body = fields?.fields.size ? { status: 'live', tree: inert(fields.tree) } : { status: 'rendering' }
    publish()
  }
  function invalidate() {
    if (!current() || !roster?.shown_id) return
    epoch++; renderDirty = true; retire()
    if (!scheduled && !rendering) scheduled = setTimeout(() => { scheduled = undefined; void render() }, 50)
  }
  async function render() {
    if (!current() || rendering || !renderDirty || !roster?.shown_id) return
    rendering = true; renderDirty = false
    const id = roster.shown_id, generation = epoch, pane = roster.panes.find(item => item.id === id)
    const settled = new Map(completed)
    try {
      if (!pane) return
      const result = await ui.render({ ...client, component: 'Pane', instance_id: id, props: {
        title: pane.title, isFocused: roster.focused_id === id, bodyColumns: layouts.get(id)?.columns ?? 80, placement: 'inline',
        scroll: { offset: layouts.get(id)?.offset ?? 0, bodyRows: layouts.get(id)?.rows ?? pane.rows ?? 12 }, view: {},
      } })
      if (!current() || epoch !== generation || roster.shown_id !== id) return
      drawing = createClaudeUiDrawing(result.tree, fields)
      function stamp(node: import('./ui-presentation.ts').ClaudeUiNode) {
        if (node.kind === 'input' || node.kind === 'select') node.revision = settled.get(node.actionId) ?? 0
        else if ('children' in node) node.children?.forEach(stamp)
      }
      stamp(drawing.tree); fields = drawing
      for (const key of revisions.keys()) if (!drawing.fields.has(key)) { revisions.delete(key); completed.delete(key) }
      body = { status: 'live', tree: drawing.tree }; publish()
    } catch (error) {
      if (current() && epoch === generation) { fields = undefined; drawing = undefined; body = { status: 'error', message: error instanceof Error ? error.message : 'Native pane unavailable' }; publish() }
    } finally {
      rendering = false
      if (current() && renderDirty && !scheduled) scheduled = setTimeout(() => { scheduled = undefined; void render() }, 50)
    }
  }
  async function refresh() {
    if (!current()) return
    rosterEpoch++; rosterDirty = true
    if (reading) return
    reading = true
    try {
      do {
        rosterDirty = false
        const revision = rosterEpoch, next = await ui.panes(client.client_id)
        if (!current()) return
        if (revision !== rosterEpoch) continue
        const changed = JSON.stringify(next) !== JSON.stringify(roster)
        if (next.shown_id !== roster?.shown_id) {
          epoch++; drawing = undefined; fields = undefined; revisions.clear(); completed.clear()
        }
        roster = next
        for (const [id, host] of scrolls) if (!next.panes.some(pane => pane.id === id)) { host.dispose(); scrolls.delete(id); layouts.delete(id) }
        if (changed) { publish(); invalidate() }
      } while (current() && rosterDirty)
    } catch (error) {
      if (current() && roster?.panes.length) { body = { status: 'error', message: error instanceof Error ? error.message : 'Native pane roster unavailable' }; publish() }
    } finally { reading = false }
  }
  return {
    get state(): ClaudeUiPanePresentation | undefined { return !disposed && roster?.panes.length ? { roster, body, ...(roster.shown_id && siteScroll(roster.shown_id).state ? { scroll: siteScroll(roster.shown_id).state } : {}) } : undefined },
    start: refresh,
    receive(event: Record<string, unknown>) {
      if (!current() || event.type !== 'system') return
      if (event.subtype === 'ui_scroll' && event.component === 'Pane' && typeof event.instance_id === 'string' && roster?.panes.some(pane => pane.id === event.instance_id)) siteScroll(event.instance_id).receive(event)
      if (event.subtype === 'ui_panes') { if (focusInFlight) refreshAfterFocus = true; else void refresh() }
      if (event.subtype === 'ui_invalidate' && event.event === 'ui.render' && event.tool_groups !== true && event.composer_placements !== true && event.terminal_placements !== true) invalidate()
      if (event.subtype === 'ui_focus' && event.client_id === client.client_id && event.component === 'Pane' && event.instance_id === roster?.shown_id) {
        const id = [...(drawing?.focusables ?? [])].find(([, value]) => value.plugin === event.plugin && value.key === event.key)?.[0]
        if (id && roster?.shown_id) options.requestFocus?.(id, focusRevisions.get(roster.shown_id) ?? 0, roster.shown_id)
      }
    },
    dispose() { for (const host of scrolls.values()) host.dispose(); scrolls.clear(); disposed = true; epoch++; drawing = undefined; fields = undefined; roster = undefined; if (scheduled) clearTimeout(scheduled) },
    scroll(event: import('./ui-presentation.ts').ClaudeUiScrollEvent) { if (event.paneId === roster?.shown_id && event.paneId) siteScroll(event.paneId).report(event) },
    ownsAction(id: string) { return drawing?.actions.has(id) === true },
    ownsField(id: string) { return fields?.fields.has(id) === true },
    async operate(event: ClaudeUiPaneEvent) {
      if (event.kind === 'layout') {
        if (!current() || event.id !== roster?.shown_id || ![event.columns, event.rows, event.offset].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000) || event.columns < 1 || event.rows < 1) return
        const next = { columns: event.columns, rows: event.rows, offset: event.offset }
        if (JSON.stringify(layouts.get(event.id)) !== JSON.stringify(next)) { layouts.set(event.id, next); invalidate() }
        return
      }
      if (!current() || operating || (event.id === null ? event.kind !== 'focus' : !roster?.panes.some(pane => pane.id === event.id))) return
      operating = true
      try {
        if (event.kind === 'show' && event.id) { epoch++; fields = undefined; retire(); await ui.showPane({ ...client, id: event.id }) }
        else if (event.kind === 'focus') await ui.focusPane({ ...client, id: event.id })
        else if (event.kind === 'close' && event.id) { retire(); await ui.closePane({ client_id: client.client_id, id: event.id }) }
        // A denied close stays open; only the native roster removes its tab/body.
        await refresh(); invalidate()
      } finally { operating = false }
    },
    async press(id: string, href?: string) {
      const snapshot = drawing, action = snapshot?.actions.get(id)
      if (!current() || operating || !snapshot || !action) return { handled: false }
      if (snapshot.links.has(id)) {
        if (!href || href.length > 2048) return { handled: false }
        try { if (!['https:', 'http:', 'file:'].includes(new URL(href).protocol)) return { handled: false } } catch { return { handled: false } }
        const allowed = snapshot.links.get(id)
        if (allowed && !allowed.has(href)) return { handled: false }
      } else if (href !== undefined) return { handled: false }
      operating = true; retire()
      try { const result = await ui.press({ ...client, ...action, ...(href ? { href } : {}) }); return { handled: current() && result.handled } }
      finally { operating = false; invalidate() }
    },
    async field(event: ClaudeUiFieldEvent) {
      const field = fields?.fields.get(event.actionId), id = roster?.shown_id
      if (!current() || !id || !field || !Number.isSafeInteger(event.revision) || event.revision <= (revisions.get(event.actionId) ?? 0) || typeof event.value !== 'string' || event.value.length > 16384) return { handled: false }
      if (field.type === 'select' ? event.kind !== 'select' || !field.options?.includes(event.value) : event.kind !== 'change' && event.kind !== 'submit') return { handled: false }
      revisions.set(event.actionId, event.revision)
      const request = { ...client, component: 'Pane', instance_id: id, plugin: field.plugin, handle: field.handle, key: field.key, value: event.value }
      const result = field.type === 'select' ? await ui.select(request) : await ui.input({ ...request, kind: event.kind as 'change' | 'submit' })
      if (current() && roster?.shown_id === id && fields?.fields.has(event.actionId)) { completed.set(event.actionId, event.revision); invalidate() }
      return { handled: current() && result.handled }
    },
    async focus(event: ClaudeUiFocusEvent): Promise<ClaudeUiFocusReply | undefined> {
      const id = event.paneId, snapshot = drawing
      if (!current() || !id || id !== roster?.shown_id || !snapshot || !Number.isSafeInteger(event.revision) || event.revision <= (focusRevisions.get(id) ?? 0)) return
      const target = typeof event.focusId === 'string' ? snapshot.focusables.get(event.focusId) : event.focusId
      if (typeof event.focusId === 'string' && !target) return
      focusRevisions.set(id, event.revision)
      const generation = epoch
      focusInFlight++
      try {
        await ui.focusPane({ ...client, id: event.isHeld ? id : null })
        if (!current() || generation !== epoch || drawing !== snapshot || focusRevisions.get(id) !== event.revision) return
        const result = await ui.focus({ ...client, component: 'Pane', instance_id: id, is_held: event.isHeld, by: event.by, ...(target !== undefined ? { element: target } : {}) })
        if (!current() || generation !== epoch || drawing !== snapshot || focusRevisions.get(id) !== event.revision) return
        if (target === undefined) return
        const focusId = result.element === null ? null : [...snapshot.focusables].find(([, item]) => item.plugin === result.element?.plugin && item.key === result.element.key)?.[0]
        if (focusId === undefined) return
        return { paneId: id, revision: event.revision, moved: result.moved, focusId, ...(result.deny ? { deny: result.deny } : {}) }
      } finally {
        focusInFlight--
        if (!focusInFlight && refreshAfterFocus) { refreshAfterFocus = false; void refresh() }
      }
    },
  }
}
