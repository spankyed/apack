// An ask a machine spawned is under way for exactly as long as the machine holds it as a child: the machine stops the
// child where the ask ends, and stopping it earlier gives the ask up. So whether one is under way is read off the
// snapshot, and a machine keeps no flag beside it to set and clear.

/** Whether the ask spawned under `id` is under way, in a snapshot of the machine that spawned it */
export const askUnderWay = (snapshot: { children: object }, id: string): boolean => id in snapshot.children
