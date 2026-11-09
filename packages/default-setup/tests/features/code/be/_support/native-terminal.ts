// The stand-in for `services.terminal` the native Claude owner is driven through.
//
// **One session, built from the listeners the owner gave at open**, because that is the contract: there is
// no window in which output has nowhere to go, so a case cannot register them afterwards either.
//
// **Not `terminal-broker.ts`, and the reason is the module graph rather than taste.** That double installs
// through `mockService`, which needs the harness `tests/setup.ts` configured. The specs here call
// `vi.resetModules()` — which is what makes their mocks of a *pack* module apply at all, since the setup
// file imports `pack-entry.ts` and puts those modules in the graph first — and that reset gives each file
// its own copy of the harness, where nothing has marked a test active. So these drive the service directly.
import { vi } from 'vitest'
import type { TerminalSession } from '@apackdev/sdk/services'

/** What the owner hands `open`: a feed and an exit, and nothing else */
export interface NativeTerminalListeners {
  onOutput(text: string): void
  onExit(code: number | null, signal: string | null): void
}

/** The parts a case wants to watch, where it is watching one */
export interface NativeSessionParts {
  pid?: number
  write?: TerminalSession['write']
  pause?: TerminalSession['pause']
  resume?: TerminalSession['resume']
  signal?: TerminalSession['signal']
}

/**
 * A session over `listeners`.
 *
 * **A signal and a terminate end it**, as they do for the real broker: the process it started is its
 * session's leader and in its own group, so either reaches it. A case about *which* signal was sent passes
 * its own `signal` and keeps the session alive to assert the escalation.
 */
export function nativeSession(listeners: NativeTerminalListeners, parts: NativeSessionParts = {}): TerminalSession {
  const ends = async () => { listeners.onExit(0, null) }
  return {
    id: 'native-1',
    pid: parts.pid ?? 0,
    scrollback: 1000,
    write: parts.write ?? vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    // Nothing here drives shell integration: the CLI is what is running, and it reports none
    facts: vi.fn(async () => ({ cwd: null, command: null, running: false, exitStatus: null })),
    pause: parts.pause ?? vi.fn(async () => {}),
    resume: parts.resume ?? vi.fn(async () => {}),
    signal: parts.signal ?? vi.fn(ends),
    terminate: vi.fn(ends),
  }
}
