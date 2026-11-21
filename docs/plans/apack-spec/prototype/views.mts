// A surface following views, modelled on the app's threads surface
// (packages/default-setup/src/features/threads/fe/state.ts), which follows nine with `fromView`: one for as long as
// the surface runs (`list`), one while a thread is open (`detail`), and one per open tab (`tab`).
//
// Today each is an actor the machine spawns and stops by hand. Here each is declared by the state that needs it,
// under `follows`, and which are followed comes from the data: nothing follows or stops following one by hand.
// `store` at the bottom stands in for the app's view host: it reads again after every commit and delivers each
// changed result.

import { deepStrictEqual } from 'node:assert'
import { given, reaching, system, type ViewHost, type ViewUpdate } from './state.mts'

interface ThreadSummary { id: string; title: string }
interface ThreadDetail { id: string; title: string; messages: number }
interface TabInfo { threadId: string; unread: number }

type App = {
  systems: {}
  surfaces: {}
  views: {
    threads: {
      list:   { args: {}; result: ThreadSummary[] }
      detail: { args: { id: string }; result: ThreadDetail }
      tab:    { args: { threadId: string }; result: TabInfo }
    }
  }
}
const state = reaching<App>()

type ThreadsSurface = {
  data: { threads: ThreadSummary[]; tabs: Record<string, TabInfo>; openTabs: string[]; problem: string | null }
  states: {
    list: {}
    detail: { data: { id: string; detail: ThreadDetail | null } }
  }
}

type ThreadsSurfaceEvent =
  // from the user
  | { type: 'SHOW_LIST' }
  | { type: 'VIEW_THREAD'; id: string }
  | { type: 'TABS_CHANGED'; open: string[] }

const threadsSurface = state<ThreadsSurface, ThreadsSurfaceEvent>()({
  data: { threads: [], tabs: {}, openTabs: [], problem: null },
  start: 'list',

  follows: {
    // Followed for as long as the surface runs.
    list: {
      feature: 'threads', view: 'list',
      args: () => ({}),
      heard: (update) => (update.ok ? { data: { threads: update.value } } : { data: { problem: `list: ${update.error}` } }),
    },

    // One for each open tab. Which tabs are open is the data; opening or closing one is all it takes.
    tab: {
      feature: 'threads', view: 'tab', each: 'openTabs',
      args: (threadId) => ({ threadId }),
      heard: (update, { key }) => (update.ok ? { data: (d) => { d.tabs[key] = update.value } } : { data: { problem: `tab: ${update.error}` } }),
    },
  },

  on: {
    SHOW_LIST:   ()       => ({ at: 'list' }),
    // Going to `detail` while already there enters it afresh, with the id of the thread to show.
    VIEW_THREAD: ({ id }) => ({ at: 'detail', data: { id, detail: null } }),

    TABS_CHANGED: ({ open }) => ({
      data: (d) => { d.openTabs = open; for (const threadId of Object.keys(d.tabs)) if (!open.includes(threadId)) delete d.tabs[threadId] },
    }),
  },

  states: {
    list: {},

    detail: {
      data: { id: given, detail: given },

      // Followed only while a thread is open, and asked for whichever thread that is.
      follows: {
        detail: {
          feature: 'threads', view: 'detail',
          args: (data) => ({ id: data.id }),
          heard: (update) => (update.ok ? { data: { detail: update.value } } : { data: { problem: `detail: ${update.error}` } }),
        },
      },
    },
  },
})

// ── running it ──────────────────────────────────────────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('views.mts')) {
  const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
  const lines: string[] = []

  // Stands in for the view host: rows, and watches that are read again after every commit.
  const rows = new Map<string, { title: string; messages: number; unread: number }>([['THR-1', { title: 'Plan', messages: 2, unread: 0 }], ['THR-2', { title: 'Notes', messages: 5, unread: 1 }]])
  const watches = new Set<{ name: string; read: () => ViewUpdate<unknown>; heard: (update: ViewUpdate<unknown>) => void; last?: string }>()
  const deliver = (): void => { for (const each of watches) { const update = each.read(); const now = JSON.stringify(update); if (now !== each.last) { each.last = now; each.heard(update) } } }
  const commit = (change: () => void): void => { change(); deliver() }
  const store: ViewHost = (_feature, view, args, heard) => {
    const of = (id: string): ViewUpdate<unknown> | undefined => (rows.has(id) ? undefined : { ok: false, error: `no thread ${id}` })
    const read = (): ViewUpdate<unknown> => {
      if (view === 'list') return { ok: true, value: [...rows].map(([id, row]) => ({ id, title: row.title })) }
      const id = (args as { id?: string; threadId?: string }).id ?? (args as { threadId: string }).threadId
      const missing = of(id)
      if (missing) return missing
      const row = rows.get(id)!
      return view === 'detail' ? { ok: true, value: { id, title: row.title, messages: row.messages } } : { ok: true, value: { threadId: id, unread: row.unread } }
    }
    const name = `${view}${JSON.stringify(args)}`
    const mine = { name, read, heard }
    watches.add(mine)
    lines.push(`      (watching ${name})`)
    setImmediate(deliver)
    return () => { watches.delete(mine); lines.push(`      (stopped  ${name})`) }
  }

  const window = system({ side: 'window', views: store })
  const surface = window.start('threads', threadsSurface)
  window.subscribe(() => { const now = window.read(surface); if (now) lines.push(`    ${JSON.stringify(now)}`) })
  const say = (line: string): void => { lines.push(line) }
  // What each step must leave behind. The lines printed at the end are for reading; these are what is checked.
  let held = 0
  const holds = (what: string, actual: unknown, expected: unknown): void => {
    try { deepStrictEqual(actual, expected) } catch (error) { console.log(lines.join('\n')); throw new Error(`${what}\n${String(error)}`) }
    held++
  }
  const watched = (): string[] => [...watches].map((each) => each.name).sort()
  const shown = () => { const now = window.read(surface); const d = now.data as { id?: string; detail?: { messages: number } | null; tabs: Record<string, { unread: number }> }; return { at: now.at, id: d.id ?? null, messages: d.detail?.messages ?? null, tabs: Object.fromEntries(Object.entries(d.tabs).map(([id, tab]) => [id, tab.unread])) } }

  await turn()
  holds('the list is followed from the start', watched(), ['list{}'])
  say('open THR-1')
  window.send(surface, { type: 'VIEW_THREAD', id: 'THR-1' });             await turn()
  holds('an open thread is followed', watched(), ['detail{"id":"THR-1"}', 'list{}'])
  holds('and shown', shown(), { at: 'detail', id: 'THR-1', messages: 2, tabs: {} })
  say('a message arrives in THR-1: the detail and the list are read again, and only what changed is delivered')
  commit(() => { rows.get('THR-1')!.messages = 3 });                       await turn()
  holds('a change to what is followed arrives', shown(), { at: 'detail', id: 'THR-1', messages: 3, tabs: {} })
  say('switch to THR-2: the view of THR-1 stops')
  window.send(surface, { type: 'VIEW_THREAD', id: 'THR-2' });             await turn()
  holds('the other thread is followed in place of the first', watched(), ['detail{"id":"THR-2"}', 'list{}'])
  holds('and shown', shown(), { at: 'detail', id: 'THR-2', messages: 5, tabs: {} })
  say('open two tabs, then close one')
  window.send(surface, { type: 'TABS_CHANGED', open: ['THR-1', 'THR-2'] }); await turn()
  holds('each open tab is followed', watched(), ['detail{"id":"THR-2"}', 'list{}', 'tab{"threadId":"THR-1"}', 'tab{"threadId":"THR-2"}'])
  holds('and shown', shown().tabs, { 'THR-1': 0, 'THR-2': 1 })
  window.send(surface, { type: 'TABS_CHANGED', open: ['THR-2'] });        await turn()
  holds('a closed tab is no longer followed', watched(), ['detail{"id":"THR-2"}', 'list{}', 'tab{"threadId":"THR-2"}'])
  holds('or shown', shown().tabs, { 'THR-2': 1 })
  say('back to the list: the detail view stops, the list and the tab carry on')
  window.send(surface, { type: 'SHOW_LIST' });                            await turn()
  holds('back at the list the thread is no longer followed, and the tab still is', watched(), ['list{}', 'tab{"threadId":"THR-2"}'])
  commit(() => { rows.get('THR-2')!.unread = 4 });                         await turn()
  holds('and a change to the tab still arrives', shown(), { at: 'list', id: null, messages: null, tabs: { 'THR-2': 4 } })
  say('stop: everything still watched stops')
  window.stop()
  holds('stopping the surface stops everything it followed', watched(), [])

  console.log(lines.join('\n'))
  console.log(`\n${held} things held`)
}
