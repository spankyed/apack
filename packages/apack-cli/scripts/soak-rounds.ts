/** One edit made while a watcher pass was running. */
export interface SoakRound {
  /** A pass read the edit. */
  readonly pickedUp: boolean;
  /** A process independent of the watcher received the edit's file event. */
  readonly bystanderSaw: boolean;
}

export interface SoakResult {
  readonly rounds: number;
  readonly pickedUp: number;
  /** The file event was delivered and the watcher still missed the edit: the watcher's fault. */
  readonly lost: number;
  /** Nothing on the machine received the event: file events had stalled, so this says nothing about the watcher. */
  readonly stalled: number;
  /** 1 when an edit was lost, 3 when none was but stalled rounds leave the answer partial, otherwise 0. */
  readonly exitCode: 0 | 1 | 3;
}

export function judgeSoak(rounds: readonly SoakRound[]): SoakResult {
  const pickedUp = rounds.filter(round => round.pickedUp).length;
  const lost = rounds.filter(round => !round.pickedUp && round.bystanderSaw).length;
  const stalled = rounds.length - pickedUp - lost;
  return { rounds: rounds.length, pickedUp, lost, stalled, exitCode: lost > 0 ? 1 : stalled > 0 || rounds.length === 0 ? 3 : 0 };
}
