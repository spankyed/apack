// The asks a surface's machine makes with `fromAsk`, for a spec that drives one with `#generated/events` mocked:
// each is held open until the spec ends it, as the code system's handler would. A spec mocks the module with this
// `fromAsk` and reads `made`:
//
//   vi.mock('#generated/events.ts', async () => ({ fromAsk: (await import('<…>/_support/asks.ts')).fromAsk }))
import { fromPromise } from 'xstate';

/** One ask a machine made, and how a spec ends it */
export interface MadeAsk {
  /** The ask as the system would receive it: its type, and the fields it was made with */
  event: { type: string; [field: string]: unknown };
  /** Whether the machine stopped waiting on it: it stopped the actor the ask ran as */
  stopped: boolean;
  /** Ends it with its answer, and waits for the machine to have taken it */
  answer(value: unknown): Promise<void>;
  /** Ends it refused: of GitHub's, with its reason, where one is given, and as a plain failure otherwise */
  refuse(message: string, more?: { kind?: string; [field: string]: unknown }): Promise<void>;
  /** Tells the machine something before the answer, as the handler's `progress` does */
  tell(update: unknown): void;
}

/** Every ask made since `resetAsks`, in the order made */
export const made: MadeAsk[] = [];

export const resetAsks = (): void => { made.length = 0; };

/** The asks of `type`, in the order made */
export const asksOf = (type: string): MadeAsk[] => made.filter((ask) => ask.event.type === type);

/** The latest ask of `type`: throws where the machine never made one, which is a different failure from a wrong answer */
export function latestAsk(type: string): MadeAsk {
  const ask = asksOf(type).at(-1);
  if (!ask) throw new Error(`no ${type} was asked; asked ${made.map((each) => each.event.type).join(', ') || 'nothing'}`);
  return ask;
}

/** The machine takes an ask's ending a turn after it ends: its promise settles, then its done event is delivered */
const taken = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/** `fromAsk` as `#generated/events` gives it, recording each ask in `made` and never ending one itself */
export const fromAsk = (_to: string, type: string) =>
  fromPromise<unknown, Record<string, unknown> | undefined>(({ input, signal, self }) => new Promise((resolve) => {
    const ask: MadeAsk = {
      event: { ...input, type },
      stopped: false,
      answer: (value) => { resolve({ ok: true, value }); return taken(); },
      refuse: (message, more) => { resolve({ ok: false, failure: { kind: 'failed', message, ...more } }); return taken(); },
      // Nothing of an ask the machine stopped waiting on arrives
      tell: (update) => { if (!ask.stopped) (self as unknown as { _parent?: { send(event: object): void } })._parent?.send({ type: `${type}.progress`, update }); },
    };
    signal.addEventListener('abort', () => { ask.stopped = true; });
    made.push(ask);
  }));
