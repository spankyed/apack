// What a terminal's programs say they are doing (OSC 7501), shaped for the windows that show it: the text made
// plain, each record marked with whether the person has looked since, and what changed between two readings.
import type { ProgramStatusRecord } from '@apackdev/sdk/services'
import type { TerminalStatus } from '../types.ts'

/**
 * Text a program chose, with what cannot be seen removed.
 *
 * The host has already refused control characters. What is left to disarm is formatting that draws nothing and
 * changes how the rest reads — a direction override makes `evil‮gnp.exe` read as `evilexe.png` — which matters
 * here because this text is shown outside the terminal, on a tab and in a notification.
 */
export const plainStatusText = (text: string | null): string | null =>
  text === null ? null : text.replace(/\p{Cf}/gu, '')

/** The records as a window is told them: plain, and each with whether it is past what the person has looked at */
export const toldStatuses = (records: readonly ProgramStatusRecord[], seen: number): TerminalStatus[] =>
  records.map(record => ({
    ...record,
    title: plainStatusText(record.title),
    message: plainStatusText(record.message),
    seen: record.changed <= seen,
  }))

/** A record that is in a state it was not in before, with the state it was in, or `null` where it is new */
export interface StatusMove {
  readonly record: ProgramStatusRecord
  readonly previous: ProgramStatusRecord['state'] | null
}

/**
 * What changed between two readings of a terminal's records.
 *
 * `leftWorking` is a turn ending as far as anything says: a record that was working is in another state, or
 * gone. `moves` is every record that entered a state.
 */
export function statusMoves(
  before: readonly ProgramStatusRecord[], after: readonly ProgramStatusRecord[],
): { readonly moves: StatusMove[]; readonly leftWorking: boolean } {
  const was = new Map(before.map(record => [record.id, record.state]))
  const now = new Map(after.map(record => [record.id, record.state]))
  return {
    moves: after
      .filter(record => was.get(record.id) !== record.state)
      .map(record => ({ record, previous: was.get(record.id) ?? null })),
    leftWorking: before.some(record => record.state === 'working' && now.get(record.id) !== 'working'),
  }
}
