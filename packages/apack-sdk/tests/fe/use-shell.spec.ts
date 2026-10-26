// useShell() reads the shell for as long as the scope calling it lives: its refs follow the shell, stop when the
// scope is disposed, and it refuses to start outside a scope, where nothing would ever stop them.
import { afterEach, beforeEach, expect, it } from 'vitest'
import { effectScope } from 'vue'
import { useShell, type HostShellSnapshot } from '../../src/fe/shell.ts'
import { bindFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts'

let observers: Array<(snapshot: HostShellSnapshot) => void>
let snapshot: HostShellSnapshot

const withSizes = (canvasHeight: number): HostShellSnapshot => ({
  context: { surfaces: [], activeSurface: { id: 'memo-pack/memos' } as never, surfaceVisibility: {}, commands: [], panelSizes: { canvasHeight, inspectionWidth: 400 } },
  hasTag: () => false,
})

beforeEach(() => {
  observers = []
  snapshot = withSizes(50)
  const application = {
    getSnapshot: () => snapshot,
    subscribe: (observer: (next: HostShellSnapshot) => void) => {
      observers.push(observer)
      return { unsubscribe: () => { observers = observers.filter((o) => o !== observer) } }
    },
    send: () => {},
    system: { get: () => undefined },
  }
  bindFeHost({ catalog: {} as never, application, secrets: {} as never,
    settings: {} as never, client: { send() {}, watchView: () => () => {} }, packs: {} as never })
})

afterEach(() => unbindFeHost())

it('follows the shell while its scope lives, and stops when the scope is disposed', () => {
  const scope = effectScope()
  const shell = scope.run(() => useShell())!
  snapshot = withSizes(80)
  for (const observer of observers) observer(snapshot)
  expect(shell.panelSizes.value.canvasHeight).toBe(80)

  scope.stop()
  expect(observers).toEqual([])
})

it('refuses to start outside a scope, naming where it runs', () => {
  expect(() => useShell()).toThrow("useShell() runs in a component's setup or an effect scope")
  expect(observers).toEqual([])
})
