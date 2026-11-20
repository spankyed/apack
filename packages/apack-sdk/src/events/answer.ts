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
