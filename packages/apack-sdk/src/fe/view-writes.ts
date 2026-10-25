// A surface's own writes over a view it shows. An editor applies the user's edit to its copy of the view's data at
// once and then sends the write, so a result of the view computed before that write landed — another commit's, or
// the editor's own previous write's — would put the old value back under the user's typing. It holds the view's
// results behind its unanswered writes instead, and once the last is answered reads the view again if it held one,
// since the view's current result by then holds every write the backend answered. A refused write reads it again too,
// which puts back what is stored in place of the edit on screen.
//
// This is TanStack Query's optimistic update, in the shape a state machine keeps: apply the edit, settle the write,
// take the server's state. Each write is recorded by its call (`recordCall`, `@apackdev/sdk/events`), and the answer
// settles it, so every write the surface records must be answered, a refusal included — one that never is holds the
// view for good.
//
// Pure functions over one value kept in the machine's context. The component that holds the view (`useView`) reads it
// again whenever `refreshes` changes, and hands the machine each result to ask `viewRead` whether to apply it.
import { recordCall, settleCall } from '../events/index.ts'

/** A surface's writes over the views it shows, and whether a result was held behind them; kept in its machine's context */
export interface ViewWrites {
  /** The writes still unanswered, by the call each was sent under */
  readonly pending: Readonly<Record<string, true>>;
  /** Whether a result was held behind them, or one of them was refused, since the view was last applied */
  readonly stale: boolean;
  /** Counts the times the view should be read again: the component holding it calls `refresh()` on each change */
  readonly refreshes: number;
}

/** No write sent yet */
export const viewWrites = (): ViewWrites => ({ pending: {}, stale: false, refreshes: 0 })

/** `writes` with the write sent under `call` unanswered: what `sendToSystem` returned for it */
export const writeSent = (writes: ViewWrites, call: string): ViewWrites =>
  ({ ...writes, pending: recordCall(writes.pending, call, true as const) })

/** Whether any write is unanswered */
export const writing = (writes: ViewWrites): boolean => Object.keys(writes.pending).length > 0

/**
 * A result of the view arrived: whether to apply it now, which is whenever no write is unanswered, or to hold it, and
 * the writes after it
 */
export function viewRead(writes: ViewWrites): { writes: ViewWrites; apply: boolean } {
  if (writing(writes)) return { writes: { ...writes, stale: true }, apply: false }
  return { writes: { ...writes, stale: false }, apply: true }
}

/**
 * An answer arrived, and `refused` says whether it refuses its write: `writes` after it. An answer to no write these
 * hold (another surface's ask, or one already settled) leaves them as they are. Once none is unanswered, a held result
 * or a refusal counts one more `refreshes`.
 */
export function writeAnswered(writes: ViewWrites, answer: { [key: string]: unknown }, refused = false): ViewWrites {
  const { recorded, pending } = settleCall(writes.pending, answer)
  if (recorded === undefined) return writes
  const stale = writes.stale || refused
  if (Object.keys(pending).length > 0) return { ...writes, pending, stale }
  return { pending, stale: false, refreshes: writes.refreshes + (stale ? 1 : 0) }
}
