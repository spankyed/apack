// Test harness for @apackdev/state machines in code/fe: attaches a recording Port to a window system so every
// ask, tell, progress update, cancellation, and child-to-parent report is observed without module mocks.
import {
  state,
  system,
  type AnyEvent,
  type Asks,
  type Clock,
  type Handle,
  type Port,
  type PortOutcome,
  type Read,
  type Shape,
  type State,
  type Value,
} from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';

/** One ask a machine made, and how a spec ends it */
export interface MadeAsk {
  /** Target feature the ask was sent to */
  to: string;
  /** The ask as the system would receive it: its type, and the fields it was made with */
  event: { type: string; [field: string]: unknown };
  /** Whether the machine stopped waiting on it */
  stopped: boolean;
  /** Ends it with its answer, and waits a microtask for the machine to settle */
  answer(value: unknown): Promise<void>;
  /** Ends it refused, with its kind/extra fields where given */
  refuse(message: string, more?: { kind?: string; [field: string]: unknown }): Promise<void>;
  /** Delivers a progress update before the answer */
  tell(update: unknown): void;
}

export interface MadeTell {
  to: string;
  event: { type: string; [field: string]: unknown };
}

export interface AskPort {
  readonly port: Port;
  readonly made: MadeAsk[];
  readonly tells: MadeTell[];
  asksOf(type: string): MadeAsk[];
  latestAsk(type: string): MadeAsk;
  tellsOf(type: string): MadeTell[];
  reset(): void;
}

/** Creates a recording Port whose asks stay open until a spec answers or refuses them */
export function createAskPort(): AskPort {
  const made: MadeAsk[] = [];
  const tells: MadeTell[] = [];

  const port: Port = {
    tell(to, event) {
      tells.push({ to, event: event as { type: string; [field: string]: unknown } });
    },
    ask(to, name, args, progress, done) {
      const payload = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
      const ask: MadeAsk = {
        to,
        event: { ...payload, type: name },
        stopped: false,
        answer: async (value) => {
          if (!ask.stopped) done({ ok: true, value });
          await Promise.resolve();
        },
        refuse: async (message, more) => {
          if (!ask.stopped) {
            const failure = { kind: 'failed', message, ...more } as PortOutcome & { ok: false } extends { failure: infer F } ? F : never;
            done({ ok: false, failure });
          }
          await Promise.resolve();
        },
        tell: (update) => {
          if (!ask.stopped) progress(update);
        },
      };
      made.push(ask);
      return () => {
        ask.stopped = true;
      };
    },
    follow(_feature, _view, _args, _updated, failed) {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  };

  const asksOf = (type: string): MadeAsk[] => made.filter((ask) => ask.event.type === type);
  const latestAsk = (type: string): MadeAsk => {
    const ask = asksOf(type).at(-1);
    if (!ask) throw new Error(`no ${type} was asked; asked ${made.map((each) => each.event.type).join(', ') || 'nothing'}`);
    return ask;
  };
  const tellsOf = (type: string): MadeTell[] => tells.filter((t) => t.event.type === type);
  const reset = (): void => {
    made.length = 0;
    tells.length = 0;
  };

  return { port, made, tells, asksOf, latestAsk, tellsOf, reset };
}

export interface MachineHarness<S extends Shape, E extends AnyEvent, A extends Asks = Asks> extends AskPort {
  readonly sys: ReturnType<typeof system>;
  readonly handle: Handle<Value<S>, E, A, any>;
  readonly reports: AnyEvent[];
  reportsOf<T extends string>(type: T): Array<AnyEvent & { type: T }>;
  read(): Value<S>;
  send(event: Read<E>): void;
  child<K extends string>(name: K): unknown;
  childHandle<K extends string>(name: K): unknown;
  stop(): void;
}

/**
 * Starts a `@apackdev/state` machine inside a window test system with a recording Port.
 * When `reports` is given, wraps the machine as a child of a tiny host state that captures every named report.
 */
const defaultClock: Clock = {
  now: () => Date.now(),
  after: (ms, run) => {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  },
};

export function startMachine<S extends Shape, E extends AnyEvent, A extends Asks = Asks>(
  machine: State<S, E, A, never>,
  options: { id?: string; clock?: Clock; reports?: readonly string[]; allowDefects?: boolean } = {},
): MachineHarness<S, E, A> {
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect, clock: options.clock ?? defaultClock });
  const askPort = createAskPort();
  sys.attach(askPort.port);

  const reports: AnyEvent[] = [];
  let handle: Handle<Value<S>, E, A, any>;

  if (options.reports && options.reports.length > 0) {
    const handlers: Record<string, (ev: AnyEvent) => void> = {};
    for (const type of options.reports) {
      handlers[type] = (ev) => {
        const { from: _from, ...rest } = ev as AnyEvent & { from?: string };
        reports.push(rest as AnyEvent);
      };
    }
    const host = state<{ starts: { target: typeof machine } }, AnyEvent>()({
      starts: () => ({ target: machine }),
      on: handlers as never,
    });
    const hostHandle = sys.start(options.id ?? 'test/host', host);
    handle = sys.child(hostHandle, 'target') as unknown as Handle<Value<S>, E, A, any>;
  } else {
    handle = sys.start(options.id ?? 'default-setup/code', machine) as unknown as Handle<Value<S>, E, A, any>;
  }

  let stopped = false;
  return {
    ...askPort,
    sys,
    handle,
    reports,
    reportsOf: <T extends string>(type: T) => reports.filter((r): r is AnyEvent & { type: T } => r.type === type),
    read: () => sys.read(handle),
    send: (event) => sys.send(handle, event),
    child: (name) => {
      const ch = (sys.child as (of: unknown, key: string) => unknown)(handle, name);
      return sys.read(ch as never);
    },
    childHandle: (name) => (sys.child as (of: unknown, key: string) => unknown)(handle, name),
    reset: () => {
      askPort.reset();
      reports.length = 0;
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (!options.allowDefects) guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}
