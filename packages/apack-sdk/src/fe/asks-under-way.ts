// Which of a machine's spawned asks are under way, as a value in the machine's own context. An ask is spawned under an
// id and stopped where it ends or is given up, and a machine that needs to know whether one is under way — to ignore a
// second push, to show a spinner — reads this record, which the machine's actions see as it stands at each action.
// The machine's children hold the same fact, and reading them from inside an action (`self.getSnapshot()`) gives the
// children from before the event being handled: an event raised in the step that spawned an ask would not see it.
//
// One writer keeps the record: `enqueueAsks`, used in place of XState's `enqueueActions`. Its `enqueue.spawnChild` and
// `enqueue.stopChild` are XState's, and each also records or clears the id. `stopAsks` is that stop as an action of its
// own, for a transition's list. Nothing else writes `asking`, and a machine that keeps it spawns and stops through these.
import { enqueueActions, type stopChild } from 'xstate'

/** The ids of a machine's spawned asks that are under way; kept in its context as `asking` */
export interface AsksUnderWay { readonly [id: string]: true }

/** No ask under way: what a machine's context starts with */
export const noAsks = (): AsksUnderWay => ({})

/** Whether any of the asks spawned under `ids` is under way */
export const askUnderWay = (asking: AsksUnderWay, ...ids: string[]): boolean => ids.some((id) => id in asking)

interface Enqueue {
  (action: unknown): void
  spawnChild(src: unknown, options?: { id?: string }): void
  stopChild(child: string | { id: string }): void
  assign(assignment: { asking: AsksUnderWay }): void
}

/** `enqueue` with its spawns and stops recorded in the context's `asking` */
function recording(enqueue: Enqueue, context: { asking?: AsksUnderWay }): Enqueue {
  let asking = context.asking
  const record = (next: AsksUnderWay): void => { asking = next; enqueue.assign({ asking }) }
  const held = (): AsksUnderWay => {
    if (!asking) throw new Error("enqueueAsks records asks in the machine's context: declare `asking: AsksUnderWay` there, starting as `noAsks()`")
    return asking
  }
  return Object.assign((action: unknown) => enqueue(action), enqueue, {
    spawnChild(src: unknown, options?: { id?: string }) {
      if (!options?.id) throw new Error('An ask is spawned under an id, which is what its end and whether it is under way are read by')
      enqueue.spawnChild(src, options)
      record({ ...held(), [options.id]: true })
    },
    stopChild(child: string | { id: string }) {
      const id = typeof child === 'string' ? child : child.id
      enqueue.stopChild(child)
      if (!(id in held())) return
      const { [id]: _stopped, ...rest } = held()
      record(rest)
    },
  })
}

/**
 * XState's `enqueueActions`, for a machine that spawns asks: `enqueue.spawnChild` and `enqueue.stopChild` also keep
 * the context's `asking`, so `askUnderWay(context.asking, id)` is true from the action that spawns an ask to the one
 * that stops it, in a guard, in a later action of the same step and in a component alike
 */
export const enqueueAsks = ((collect: (args: { enqueue: Enqueue; context: { asking?: AsksUnderWay } }) => void) =>
  (enqueueActions as unknown as (collect: (args: { enqueue: Enqueue; context: { asking?: AsksUnderWay } }) => void) => unknown)(
    (args) => collect({ ...args, enqueue: recording(args.enqueue, args.context) }),
  )) as unknown as typeof enqueueActions

/** An action that stops the asks spawned under `ids` and clears them from `asking`: XState's `stopChild`, recorded */
export const stopAsks = ((...ids: string[]) =>
  enqueueAsks(({ enqueue }) => { for (const id of ids) enqueue.stopChild(id) })) as unknown as (...ids: string[]) => ReturnType<typeof stopChild>
