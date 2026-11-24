// An ask: an event a system answers exactly once, with what it was asked for or with why it could not be done.
//
// A system's contract declares its asks (`asks`), each with the fields it takes, what it answers with, what it may
// say before answering and the ways it may fail that an asker can act on. The system answers them with a table
// (`defineSystem`'s `answers`). An asker gets how the ask ended as a value: it awaits `ask`, or its machine invokes
// or spawns `fromAsk`.
//
// On the wire the answer is one of two standard messages, correlated by the envelope's call like any reply:
// `ASK_ANSWERED` with the answer, or `ASK_FAILED` with a failure of a kind and a message, with `ASK_PROGRESS` before
// either for what the handler said meanwhile. The ask that was made takes them, and no machine handles one.
//
// Two kinds every ask may fail as, whatever its contract says: `failed`, for anything its handler did not name (a
// bug, a disk that gave out), and `unavailable`, for an ask nothing took — the system is not running, or the state
// it is in does not accept the ask — which the bus answers itself.
import type { Outcome } from '../helpers/outcome.ts';

/** One ask a system answers, as its contract declares it under `asks` */
export interface AskDeclaration {
  /** The fields an asker sends beside `type`. None when absent */
  args?: object;
  /** What the handler answers with. Absent, or `void`, for an ask whose answer is only that it was done */
  answer?: unknown;
  /**
   * The ways it may fail that an asker can act on, each with the data its failure carries beside its kind and
   * message: `{ 'name-taken': { existingId: string } }`. `failed` and `unavailable` are every ask's, and not declared
   */
  refuses?: Record<string, object>;
  /**
   * What its handler tells whoever asked before the answer, each time it has something: a search's matches as they
   * are found, how far a push has got. Absent for an ask that only answers
   */
  progress?: unknown;
}

/** What comes back for an ask, as message types: its progress and its two answers. Every surface and system receives them */
export const ASK_ANSWER_TYPES = ['ASK_ANSWERED', 'ASK_FAILED', 'ASK_PROGRESS'] as const;

/** What an asker sends to stop an ask it no longer waits on: the handler's `signal` aborts. Every system accepts it */
export const ASK_CANCELLED = 'ASK_CANCELLED';

/** The kinds every ask may fail as: anything its handler did not name, and an ask nothing took */
export type StandardFailureKind = 'failed' | 'unavailable';

/** The asks a contract declares, by name; none when it declares none */
export type ContractAsks<C> = C extends { asks: infer Asks } ? Asks : {};

/** The names of the asks a contract declares */
export type AskName<C> = keyof ContractAsks<C> & string;

/** The fields an ask takes beside `type` */
export type AskPayload<D> = D extends { args: infer Payload } ? Payload : {};

/** What an ask is answered with: `void` for one that is only done */
export type AnswerPayload<D> = D extends { answer: infer Answer } ? Answer : void;

/** What an ask's handler tells its asker before the answer: `never` for an ask that declares no progress */
export type ProgressPayload<D> = D extends { progress: infer Progress } ? Progress : never;

/** The failures an ask declares, by kind, with what each carries */
export type DeclaredFailures<D> = D extends { refuses: infer Fails } ? Fails : {};

/** The kinds an ask declares it may fail as, beside the standard two */
export type DeclaredFailureKind<D> = keyof DeclaredFailures<D> & string;

/**
 * Why an ask was not done, as its asker receives it: a kind to branch on and a message to show, with whatever data
 * its declaration gives that kind. A surface that only shows reads `message`; one that does something different for
 * a document that is gone reads `kind`, and never the wording.
 */
export type AskFailure<D = {}> =
  | { [K in DeclaredFailureKind<D>]: { readonly kind: K; readonly message: string } & Omit<DeclaredFailures<D>[K], 'kind' | 'message'> }[DeclaredFailureKind<D>]
  | { readonly kind: StandardFailureKind; readonly message: string };

/** How an ask ended, as a value: its answer, or why it was not done */
export type AskOutcome<D> = Outcome<AnswerPayload<D>, AskFailure<D>>;

/** The event an asker sends for one of a contract's asks */
export type AskEventOf<C, K extends AskName<C>> = { type: K } & AskPayload<ContractAsks<C>[K]>;

/** Every ask event a contract declares: what a system receives for its asks */
export type AskEventsOf<C> = { [K in AskName<C>]: AskEventOf<C, K> }[AskName<C>];

/** The events a set of asks arrives as: what a machine that answers them lists among the events it handles */
export type AsksEvents<A> = { [K in keyof A & string]: { type: K } & AskPayload<A[K]> }[keyof A & string];

/** An ask that was done: which was asked, and its answer */
export type AskAnswered<K extends string = string, A = unknown> = { type: 'ASK_ANSWERED'; asked: K; answer: A };

/** An ask that was not done: which was asked, and why */
export type AskFailed<K extends string = string, F extends { kind: string } = AskFailure> = { type: 'ASK_FAILED'; asked: K; failure: F };

/** Something an ask's handler told its asker before the answer: which was asked, and what it said */
export type AskProgressed<K extends string = string, P = unknown> = { type: 'ASK_PROGRESS'; asked: K; update: P };

/**
 * The event a machine that invokes an ask (`fromAsk`) is sent for each thing its handler tells it before the answer:
 * `<ask>.progress`, so a transition names the ask it is about and needs no guard.
 */
export type ProgressEventOf<C, K extends AskName<C>> = { type: `${K}.progress`; update: ProgressPayload<ContractAsks<C>[K]> };

/** System ref → the asks it declares, by name: what types `ask` against the systems a pack can reach */
export type SystemAskMap = { [system: string]: { [ask: string]: AskDeclaration } };

/**
 * A refusal a handler throws, for a reason its asker can act on: one of the kinds the ask declares, the message to
 * show, and the data the kind carries. Built by the `refuse` a handler is handed, which the compiler holds to the
 * ask's declaration; anything else a handler throws is answered as `failed`.
 */
export class AskError extends Error {
  readonly kind: string;
  readonly data?: object;
  constructor(kind: string, message: string, data?: object) {
    super(message);
    this.name = 'AskError';
    this.kind = kind;
    this.data = data;
  }
}

/**
 * What a handler is handed to refuse its ask with: `throw refuse('not-found', 'Document not found')`. The data a
 * kind declares is required when the declaration has required fields, and refused when it declares none.
 *
 * It returns the error rather than throwing it, so a handler writes `throw`: TypeScript narrows after a `throw`, and
 * does not after a call it cannot see never returns.
 */
export type RefuseOf<D> = <K extends DeclaredFailureKind<D>>(
  kind: K,
  message: string,
  ...data: {} extends DeclaredFailures<D>[K] ? [data?: DeclaredFailures<D>[K]] : [data: DeclaredFailures<D>[K]]
) => AskError;

/** @internal The `refuse` a handler is handed: one implementation, typed per ask where it is handed */
export const _refuse = (kind: string, message: string, data?: object): AskError => new AskError(kind, message, data);

/**
 * The kinds an error from the disk is, for an ask that declares them: a file or folder that is not there, or one
 * closed to this user. An errno nobody declared is `failed`, like any other error.
 */
const DISK_FAILURE_KINDS: Readonly<Record<string, string>> = {
  ENOENT: 'not-found',
  ENOTDIR: 'not-found',
  EACCES: 'no-access',
  EPERM: 'no-access',
};

/**
 * @internal The failure an error is answered as: an `AskError`'s own kind and data; else, for an error from the
 * disk, the kind it is (`DISK_FAILURE_KINDS`) where the ask declares that kind; else `failed`.
 *
 * `declared` is what the bus read from the asked system's contract. Absent where nothing did (a spec driving a
 * machine directly), and then the disk's kind is trusted, there being nothing to hold it to.
 */
export function _askFailureOf(error: unknown, declared?: readonly string[]): { kind: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof AskError) return { ...error.data, kind: error.kind, message };
  const code = (error as { code?: unknown } | null)?.code;
  const disk = typeof code === 'string' ? DISK_FAILURE_KINDS[code] : undefined;
  if (disk !== undefined && (declared === undefined || declared.includes(disk))) return { kind: disk, message };
  return { kind: 'failed', message };
}

/** @internal The answer to an ask that was done */
export const _answered = (asked: string, answer: unknown): AskAnswered => ({ type: 'ASK_ANSWERED', asked, answer });

/** @internal The answer to an ask that was not done */
export const _failedAnswer = (asked: string, failure: { kind: string; message: string }): AskFailed<string, { kind: string; message: string }> =>
  ({ type: 'ASK_FAILED', asked, failure });

/** @internal What an ask's handler told its asker before the answer */
export const _progressed = (asked: string, update: unknown): AskProgressed => ({ type: 'ASK_PROGRESS', asked, update });

/** @internal The answer the bus gives an ask nothing took */
export const _unavailable = (asked: string, message: string) => _failedAnswer(asked, { kind: 'unavailable', message });

/** Whether an event is one of the two answers an ask gets */
export const isAskAnswer = (event: { type: string }): event is AskAnswered | AskFailed =>
  event.type === 'ASK_ANSWERED' || event.type === 'ASK_FAILED';
