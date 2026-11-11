// What a terminal host is mounted inside: the code surface's scope, and the one child it reaches.
//
// `useSurface()` answers from the surface scope the host renders a surface's areas in, so a component that
// reaches its actor cannot be mounted without one — and the code surface's own machine is not what a
// terminal host's cases are about. This stands in for it with the context those hosts select and the one
// child they send to, so a case drives the surface the way the surface's own transitions would and reads
// back what the component sent.
import { ref, createApp, h, nextTick, type App, type Component, type Ref } from 'vue'
import { assign, createActor, createMachine, sendTo, type AnyActorRef, type AnyEventObject } from 'xstate'
import { SurfaceScope } from '@apackdev/sdk/fe'
import { fakeSettings, startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing'
import { bindSettings } from '#generated/settings-fe.ts'
import type { CodeSettings } from '#generated/types.ts'
import type { TerminalActivity, TerminalInfo, TerminalRewindView } from '#features/code/fe/features/terminal/state.ts'

/** The ref the code surface runs under, which is what a scope and a settings target name it by */
export const CODE_SURFACE = 'default-setup/code'

export interface OpenFile {
  path: string
  isTerminal?: boolean
}

export interface CodeSurfaceOptions {
  terminals?: TerminalInfo[]
  panelTerminalId?: string | null
  panelTerminalExpanded?: boolean
  openFiles?: OpenFile[]
  settings?: Partial<CodeSettings>
}

export interface CodeSurfaceHarness {
  /** The element the component tree is mounted into */
  readonly root: HTMLElement
  /** Every event a host sent the terminal child, in the order it sent them */
  readonly sent: AnyEventObject[]
  /** Mounts `component` as part of the code surface; the ref is its exposed members */
  mount<T>(component: Component, props?: Record<string, unknown>): Ref<T | undefined>
  /** The terminal list the backend published, as the child actor holds it */
  setTerminals(terminals: TerminalInfo[]): Promise<void>
  /** What each terminal's program has said off its screen, as the child actor holds it */
  setActivity(activity: Record<string, TerminalActivity>): Promise<void>
  /** The recording this window has open to look back through, or none */
  setRewind(rewind: TerminalRewindView | null): Promise<void>
  selectPanelTerminal(terminalId: string | null): Promise<void>
  togglePanel(): Promise<void>
  /** Vue's queue and the panel's watcher, which attaches a tick after a change */
  settle(): Promise<void>
  /** Unmounts the host alone, which is what a tab switch or a panel drag does to it */
  unmount(): void
  stop(): void
}

/** A terminal, with the fields a host reads */
export const terminalInfo = (id: TerminalInfo['id'], fields: Partial<TerminalInfo> = {}): TerminalInfo => ({
  // The session a window draws it from, which every running terminal has; a case about one that ended passes none
  id, session: `session-of-${id}`, title: 'zsh', pid: 4242, shell: '/bin/zsh', cwd: '/tmp', active: true, generation: 1, cols: 80, rows: 24,
  // The host's number, as a session carries it; a case that cares about the bound passes its own
  submit: '\n',
  ...fields,
})

export function startCodeSurface(options: CodeSurfaceOptions = {}): CodeSurfaceHarness {
  const sent: AnyEventObject[] = []

  const terminalMachine = createMachine({
    types: {} as {
      context: { terminals: TerminalInfo[]; activity: Record<string, TerminalActivity>; rewind: TerminalRewindView | null }
      events: AnyEventObject
    },
    id: 'terminal',
    context: { terminals: options.terminals ?? [], activity: {}, rewind: null },
    on: {
      'test.TERMINALS': { actions: assign({ terminals: ({ event }) => event.terminals as TerminalInfo[] }) },
      'test.ACTIVITY': { actions: assign({ activity: ({ event }) => event.activity as Record<string, TerminalActivity> }) },
      'test.REWIND': { actions: assign({ rewind: ({ event }) => event.rewind as TerminalRewindView | null }) },
      '*': { actions: ({ event }) => { sent.push(event) } },
    },
  })

  const codeMachine = createMachine({
    types: {} as {
      context: { panelTerminalId: string | null; panelTerminalExpanded: boolean; openFiles: OpenFile[]; settings: CodeSettings }
      events: AnyEventObject
    },
    id: CODE_SURFACE,
    invoke: { id: 'terminal', src: terminalMachine },
    context: {
      panelTerminalId: options.panelTerminalId ?? null,
      panelTerminalExpanded: options.panelTerminalExpanded ?? false,
      openFiles: options.openFiles ?? [],
      settings: (options.settings ?? {}) as CodeSettings,
    },
    on: {
      SELECT_PANEL_TERMINAL: { actions: assign({ panelTerminalId: ({ event }) => event.terminalId as string | null }) },
      TOGGLE_PANEL_TERMINAL: { actions: assign({ panelTerminalExpanded: ({ context }) => !context.panelTerminalExpanded }) },
      // A component sends its child through the surface, which routes the child's events to it as the real one does
      'terminal.*': { actions: sendTo('terminal', ({ event }) => event) },
    },
  })

  const code = createActor(codeMachine, { id: CODE_SURFACE })
  code.start()
  const terminal = code.getSnapshot().children.terminal as AnyActorRef

  const stopRuntime = startFeTestRuntime({
    application: { system: { get: () => code }, subscribe: () => ({ unsubscribe() {} }) } as never,
  })
  const settings = bindSettings(fakeSettings({
    features: { [CODE_SURFACE]: { confirmTerminalClose: false, terminalScripts: [], ...options.settings } },
  }))
  settings.activate()

  const root = document.createElement('div')
  document.body.appendChild(root)
  let app: App | undefined

  // Three turns: the change, the watcher's own `await nextTick()`, and the render its attach causes
  const settle = async () => { await nextTick(); await nextTick(); await nextTick() }

  return {
    root,
    sent,
    mount<T>(component: Component, props: Record<string, unknown> = {}) {
      const exposed = ref<T>()
      app = createApp({
        render: () => h(SurfaceScope, { surface: CODE_SURFACE }, {
          default: () => h(component, { ...props, ref: exposed }),
        }),
      })
      app.mount(root)
      return exposed as Ref<T | undefined>
    },
    async setTerminals(terminals) {
      terminal.send({ type: 'test.TERMINALS', terminals })
      await settle()
    },
    async setActivity(activity) {
      terminal.send({ type: 'test.ACTIVITY', activity })
      await settle()
    },
    async setRewind(rewind) {
      terminal.send({ type: 'test.REWIND', rewind })
      await settle()
    },
    async selectPanelTerminal(terminalId) {
      code.send({ type: 'SELECT_PANEL_TERMINAL', terminalId })
      await settle()
    },
    async togglePanel() {
      code.send({ type: 'TOGGLE_PANEL_TERMINAL' })
      await settle()
    },
    settle,
    unmount() {
      app?.unmount()
      app = undefined
    },
    stop() {
      app?.unmount()
      app = undefined
      root.remove()
      settings.dispose()
      code.stop()
      stopRuntime()
      stopFeTestRuntime()
    },
  }
}
