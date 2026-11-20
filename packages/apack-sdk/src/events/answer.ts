import type { Reply } from './index.ts';

/** What `answerWith` does about work that could not be done */
export interface AnswerWithOptions<E extends { type: string }> {
  /** The answer for work that failed, from what it threw or rejected with: what the asker is told */
  readonly failed: (error: unknown) => E;
  /**
   * Told of a failure nobody asked about, which no window will show: work a handler does for an applier or a
   * migration has no asker. Left out, such a failure is dropped.
   */
  readonly unasked?: (error: unknown) => void;
}

const isThenable = <T>(value: T | PromiseLike<T>): value is PromiseLike<T> =>
  typeof (value as { then?: unknown } | null)?.then === 'function';

/**
 * Does a handler's work and answers whoever asked, **whichever way the work ends**: with the event it made, or
 * with the one `failed` makes of why it could not. A window that asked shows nothing until it is answered, and a
 * surface that holds its views behind its own writes holds them for good behind one that is not, so the answer is
 * not left to each handler to remember on its failure path.
 *
 * - `work` runs whether or not anybody asked (`reply` is absent for a message that named no sender), since a
 *   write is wanted for its effect. It may throw, and a promise it returns may reject: both are a failure, and
 *   there is one way to fail. Work that finds nothing to answer with throws rather than returning a failure event.
 * - Work that returns its event is answered before this returns, so a synchronous handler stays one.
 * - Nobody to answer and nothing gone wrong is silence. Nobody to answer and a failure is `unasked`'s.
 *
 * The promise settles once the answer has been given and never rejects for the work: a handler starts it with
 * `void`. It rejects only if answering itself throws, which is the bus's failure and not the work's.
 */
export function answerWith<E extends { type: string }>(
  reply: Reply<E> | undefined, work: () => E | PromiseLike<E>, options: AnswerWithOptions<E>,
): Promise<void> {
  const fail = (error: unknown): void => {
    if (reply) reply(options.failed(error));
    else options.unasked?.(error);
  };
  let made: E | PromiseLike<E>;
  try {
    made = work();
  } catch (error) {
    fail(error);
    return Promise.resolve();
  }
  if (!isThenable(made)) {
    reply?.(made);
    return Promise.resolve();
  }
  // Two handlers rather than a `catch` after: a throw from answering is not the work failing, and is not answered again
  return Promise.resolve(made).then((event) => { reply?.(event); }, fail);
}

/**
 * Why an ask was not answered with what it asked for, as its asker may act on it.
 *
 * `kind` is the part to branch on: one of the reasons the answering feature declares, or `'failed'` for
 * anything it did not name — a bug, a disk that gave out. `message` is the part to show. A surface that only
 * shows reads `message`; one that does something different for a document that is gone reads `kind`, and never
 * the wording of a message.
 */
export type AskFailure<TKind extends string = string> = {
  readonly kind: TKind | 'failed';
  readonly message: string;
};

/**
 * The one answer every refused ask gets: which event was asked (`asked`), and why it was not done.
 *
 * A feature declares it among what its system sends, with the kinds its asks can fail as:
 *
 * ```ts
 * export type OutgoingNotesEvents =
 *   | { type: 'NOTE_CREATED'; … }
 *   | AskFailedEvent<'not-found' | 'would-nest-in-itself', IncomingNotesEvents['type']>
 * ```
 *
 * It is the answer to one ask, replied to whoever made it and correlated by the envelope's call as any reply is,
 * so two asks under way are told apart without `asked`: that field is for a surface that handles a kind of
 * failure the same way whichever of its asks it was for, and wants to know which it was.
 */
// A type and not an interface: an event is sent as a record of unknown fields, which an interface is not assignable to
export type AskFailedEvent<TKind extends string = string, TAsked extends string = string> = {
  type: 'ASK_FAILED';
  asked: TAsked;
  failure: AskFailure<TKind>;
};

/**
 * Thrown by a handler to refuse an ask for a reason its asker can act on. Anything else a handler throws is
 * answered as `'failed'`, with its message.
 */
export class AskError<TKind extends string = string> extends Error {
  constructor(readonly kind: TKind, message: string) {
    super(message);
    this.name = 'AskError';
  }
}

/**
 * The failure an error is answered as: an `AskError`'s own kind, else the kind `kindOf` reads off it (an errno,
 * a typed error of the feature's), else `'failed'`.
 */
export function askFailureOf<TKind extends string>(error: unknown, kindOf?: (error: unknown) => TKind | undefined): AskFailure<TKind> {
  const message = error instanceof Error ? error.message : String(error);
  const kind = error instanceof AskError ? error.kind as TKind : kindOf?.(error);
  return { kind: kind ?? 'failed', message };
}
