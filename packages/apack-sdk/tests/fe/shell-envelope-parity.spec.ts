// The shell's `SEND_TO_SURFACE` is a second envelope, and this is what stops a field being lost in it.
//
// `deliverInWindow` (`events/index.ts`) is the window's counterpart of the bus: it takes a `Message` and
// hands the shell a `SEND_TO_SURFACE` built **field by field**. So a field added to `Message` and not named
// there simply does not reach the surface — no error, no dropped message, just a value that is never read.
// Every other boundary the envelope crosses has a guard against that: `bus.send`'s schema is held by
// `api/tests/transport/bus-send-sender.spec.ts`'s `Required<Omit<Message, 'client'>>` sample, and the drive
// client's hand-written mirror by `apack-testing/tests/engine/bus-message-parity.spec.ts`. This door had
// none, which is why the field it would have lost is the one this file was written for.
//
// It is deliberately **not** full parity: the shell event is a different shape by design — `surface` and
// `events` in place of `to` and `event`, an `asker` the shell resolves, and no `client`, a window being one.
// What has to carry across is the part a surface reads, which is the correlation.
import { describe, expect, it } from 'vitest';
import type { HostShellEvent } from '../../src/fe/shell.ts';
import type { Message } from '../../src/events/index.ts';

type SendToSurface = Extract<HostShellEvent, { type: 'SEND_TO_SURFACE' }>;

/** Mutual assignability, so neither widening nor narrowing a field passes */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** What a surface reads off a send, whichever envelope brought it */
type Carried = 'call' | 'answering' | 'from' | 'via' | 'diagnostics';

describe("the shell's second envelope", () => {
  /**
   * Narrow a field here — `answering?: boolean` where the envelope says `string` — and this stops compiling
   * rather than silently handing the shell a value the surface cannot use.
   */
  it('carries the envelope fields a surface reads, with the envelope types', () => {
    const matches: Same<Pick<Message, Carried>, Pick<SendToSurface, Carried>> = true;
    expect(matches, 'add the missing field to the shell event and forward it in deliverInWindow').toBe(true);
  });

  /**
   * And the part that is *not* parity, stated so the exclusion is a decision rather than an oversight: a
   * window is one connection, so it has no `client` to be told about, and routing here is by `surface`.
   */
  it('does not carry what a window has no use for', () => {
    const noClient: Same<'client' extends keyof SendToSurface ? true : false, false> = true;
    expect(noClient, 'a window is one connection; `client` names which, which it cannot need').toBe(true);
  });
});
