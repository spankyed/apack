// What a terminal's programs say they are doing (OSC 7501), as its tab shows it and as the person is told it.
// Pure: the surface's machine and its components decide when, and this says what.
import type { TerminalStatus } from '../../../be/types.ts'

/** A record that is waiting on the person, or finished or failed without their having looked */
const wantsThePerson = (record: TerminalStatus): boolean =>
  record.state === 'blocked' || ((record.state === 'done' || record.state === 'error') && !record.seen)

/** How much a record matters to someone glancing at a tab: least first */
const urgency = (record: TerminalStatus): number => {
  if (record.state === 'blocked') return 4
  if (!wantsThePerson(record)) return record.state === 'working' ? 1 : record.state === 'idle' ? 0 : -1
  return record.state === 'error' ? 3 : 2
}

/**
 * The one record a tab shows of everything its terminal's programs say: what is waiting on the person first,
 * then what failed, what finished, what is working, and what is idle. A record the person has already looked
 * at is not shown again.
 */
export function statusToShow(statuses: readonly TerminalStatus[] | undefined): TerminalStatus | undefined {
  let shown: TerminalStatus | undefined
  for (const record of statuses ?? []) {
    if (urgency(record) < 0) continue
    if (!shown || urgency(record) > urgency(shown)) shown = record
  }
  return shown
}

/** Whether something here waits on the person, finished or failed, that they have not looked at since */
export const needsLooking = (statuses: readonly TerminalStatus[] | undefined): boolean =>
  (statuses ?? []).some(record => record.state !== 'working' && record.state !== 'idle' && !record.seen)

/**
 * Whether the person looked at the terminal between what a window held and what it is told now, in whichever
 * window they did: a record that has not changed is seen where it was not.
 */
export const lookedAt = (before: readonly TerminalStatus[] | undefined, after: readonly TerminalStatus[]): boolean =>
  after.some(record => record.seen
    && (before ?? []).some(was => was.id === record.id && was.changed === record.changed && !was.seen))

/**
 * The record that newly wants the person, between what a window held and what it is told now: one that
 * entered `blocked`, `done` or `error`. Never one naming a program other than the one in front — a file
 * printed to a terminal can say an agent is asking for permission, and that is drawn muted and tells nobody.
 */
export function newlyWanting(
  before: readonly TerminalStatus[] | undefined, after: readonly TerminalStatus[],
): TerminalStatus | undefined {
  const was = new Map((before ?? []).map(record => [record.id, record.state]))
  return after
    .filter(record => record.confirmed !== 'mismatched' && wantsThePerson(record) && was.get(record.id) !== record.state)
    .sort((a, b) => urgency(b) - urgency(a))[0]
}

/** What a record says, in a few words */
export function statusSays(record: Pick<TerminalStatus, 'state' | 'kind'>): string {
  switch (record.state) {
    case 'idle': return 'Idle'
    case 'working': return 'Working'
    case 'done': return 'Finished'
    case 'error': return 'Failed'
    case 'blocked':
      return record.kind === 'permission' ? 'Needs permission'
        : record.kind === 'question' ? 'Has a question'
          : record.kind === 'auth' ? 'Needs you to sign in'
            : 'Waiting on you'
  }
}

/** How long ago `sinceMs` was, as a tab says it: `now`, `40s`, `4m`, `2h`, `3d` */
export function waited(sinceMs: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - sinceMs) / 1000))
  if (seconds < 5) return 'now'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

/**
 * What a system notification for a record says. **The terminal first**, so that a program cannot pass itself
 * off as one running somewhere else: `<terminal> — <program>`, then what it needs and what it said of it.
 */
export function statusNotification(terminal: string, record: TerminalStatus): { title: string; body: string } {
  return {
    title: record.app ? `${terminal} — ${record.app}` : terminal,
    body: [statusSays(record), record.title, record.message].filter(Boolean).join(' · '),
  }
}

/** What a tab's status mark says when pointed at */
export function statusTitle(record: TerminalStatus, now: number): string {
  const said = [record.app, statusSays(record), record.title, record.message].filter(Boolean).join(' · ')
  const progress = record.progress === null ? '' : `, ${record.progress}%`
  const since = waited(record.sinceMs, now)
  const unconfirmed = record.confirmed === 'mismatched' ? ' — reported by a program other than the one in front' : ''
  return `${said}${progress}${since === 'now' ? '' : `, for ${since}`}${unconfirmed}`
}
