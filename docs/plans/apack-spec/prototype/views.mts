// A surface following views, modelled on the app's threads surface
// (packages/default-setup/src/features/threads/fe/state.ts), which follows nine with `fromView`: one for as long as
// the surface runs (`list`), one while a thread is open (`detail`), and one per open tab (`tab`).
//
// Today each is an actor the machine spawns and stops by hand. Here each is a `watch` owned by the state that needs
// it, so it ends when that state does. `store` at the bottom stands in for the app's view host: it reads again after
// every commit and delivers each changed result.

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
  // from the views it follows
  | { type: 'THREADS.READ'; threads: ThreadSummary[] }
  | { type: 'DETAIL.READ'; detail: ThreadDetail }
  | { type: 'TAB.READ'; tab: TabInfo }
  | { type: 'VIEW_FAILED'; view: string; error: string }

const threadsSurface = state<ThreadsSurface, ThreadsSurfaceEvent>()({
  data: { threads: [], tabs: {}, openTabs: [], problem: null },
  start: 'list',

  // Followed for as long as the surface runs.
  run({ watch, send }) {
    watch('list', 'threads', 'list', {}, (update) =>
      send(update.ok ? { type: 'THREADS.READ', threads: update.value } : { type: 'VIEW_FAILED', view: 'list', error: update.error }))
  },

  on: {
    SHOW_LIST:   ()       => ({ at: 'list' }),
    // Going to `detail` while already there enters it afresh: the view of the last thread stops, and this one starts.
    VIEW_THREAD: ({ id }) => ({ at: 'detail', data: { id, detail: null } }),

    'THREADS.READ': ({ threads })     => ({ data: { threads } }),
    'TAB.READ':     ({ tab })         => ({ data: (d) => { d.tabs[tab.threadId] = tab } }),
    VIEW_FAILED:    ({ view, error }) => ({ data: { problem: `${view}: ${error}` } }),

    // One view per open tab: a keyed set, started and stopped as the set changes.
    TABS_CHANGED: ({ open }, { data, watch, unwatch, send }) => {
      for (const threadId of data.openTabs) if (!open.includes(threadId)) unwatch(`tab:${threadId}`)
      for (const threadId of open) {
        if (data.openTabs.includes(threadId)) continue
        watch(`tab:${threadId}`, 'threads', 'tab', { threadId }, (update) =>
          send(update.ok ? { type: 'TAB.READ', tab: update.value } : { type: 'VIEW_FAILED', view: 'tab', error: update.error }))
      }
      return { data: (d) => { d.openTabs = open; for (const threadId of Object.keys(d.tabs)) if (!open.includes(threadId)) delete d.tabs[threadId] } }
    },
  },

  states: {
    list: {},

    detail: {
      data: { id: given, detail: given },

      // Followed only while a thread is open, with that thread's id.
      run({ data, watch, send }) {
        watch('detail', 'threads', 'detail', { id: data.id }, (update) =>
          send(update.ok ? { type: 'DETAIL.READ', detail: update.value } : { type: 'VIEW_FAILED', view: 'detail', error: update.error }))
      },

      on: {
        'DETAIL.READ': ({ detail }) => ({ data: { detail } }),
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

  await turn()
  say('open THR-1')
  window.send(surface, { type: 'VIEW_THREAD', id: 'THR-1' });             await turn()
  say('a message arrives in THR-1: the detail and the list are read again, and only what changed is delivered')
  commit(() => { rows.get('THR-1')!.messages = 3 });                       await turn()
  say('switch to THR-2: the view of THR-1 stops')
  window.send(surface, { type: 'VIEW_THREAD', id: 'THR-2' });             await turn()
  say('open two tabs, then close one')
  window.send(surface, { type: 'TABS_CHANGED', open: ['THR-1', 'THR-2'] }); await turn()
  window.send(surface, { type: 'TABS_CHANGED', open: ['THR-2'] });        await turn()
  say('back to the list: the detail view stops, the list and the tab carry on')
  window.send(surface, { type: 'SHOW_LIST' });                            await turn()
  commit(() => { rows.get('THR-2')!.unread = 4 });                         await turn()
  say('stop: everything still watched stops')
  window.stop()

  console.log(lines.join('\n'))
}
