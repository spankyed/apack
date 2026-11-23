// What a session does when a step after the attach fails, and how long it waits for `host/drive`.
//
// Both subjects are one defect: two questions asked at once against one app. The second's claim is refused
// — correctly, since two drivers must not receive each other's answers — but the refusal was reported and
// then nothing closed the CDP connection or the socket, so the process sat there for ever. Measured before
// the fix: `npm run dev:drive -- --eval` printed its reason to stderr and was still running 25s later.
import { describe, expect, it, vi } from 'vitest';
import { _attachRollback, _claimDrive } from '../../src/engine/index.ts';

const conflict = () => Object.assign(new Error('"host/drive" is already claimed'), { code: 'CONFLICT' });

describe('a step that fails after the attach', () => {
  /**
   * **A handle left open does not fail, it hangs**: Node keeps running while one is, so the reason reaches
   * stderr and the process never exits — which reads as the verb hanging rather than as a refusal.
   */
  it('closes what was already open in reverse order', async () => {
    const order: string[] = [];
    const closeFirst = vi.fn(() => { order.push('first'); });
    const closeSecond = vi.fn(() => { order.push('second'); });

    await expect(_attachRollback(async (deferClose) => {
      deferClose(closeFirst);
      deferClose(closeSecond);
      throw new Error('refused');
    })).rejects.toThrow('refused');

    expect(closeFirst).toHaveBeenCalledOnce();
    expect(closeSecond).toHaveBeenCalledOnce();
    expect(order).toEqual(['second', 'first']);
  });

  it('leaves it open when the work succeeds', async () => {
    const close = vi.fn();

    expect(await _attachRollback(async (deferClose) => {
      deferClose(close);
      return 'the session';
    })).toBe('the session');

    expect(close).not.toHaveBeenCalled();
  });

  /**
   * The caller needs the reason it failed, not a reason about tidying up.
   *
   * `close` here is a socket and a CDP connection, and either can throw on one that has already gone — so
   * this is the ordinary case rather than an exotic one, and letting it through would hand back an error
   * about closing in place of the refusal this function exists to deliver.
   */
  it('reports what failed rather than what the cleanup did', async () => {
    const close = vi.fn(() => { throw new Error('and the close threw too'); });

    await expect(_attachRollback(async (deferClose) => {
      deferClose(close);
      throw new Error('the claim was refused');
    })).rejects.toThrow('the claim was refused');
    expect(close, 'and it still tried to close').toHaveBeenCalled();
  });
});

describe('claiming host/drive', () => {
  /**
   * Every claim is a question's now, held for about a second, so two agents asking at once is ordinary
   * rather than a conflict to report. Waiting never takes a live claim — it waits for one to end.
   */
  it('waits out a holder that lets go', async () => {
    let refusals = 2;
    const claim = vi.fn(async () => { if (refusals-- > 0) throw conflict(); });

    await _claimDrive({ claim }, 5_000);

    expect(claim).toHaveBeenCalledTimes(3);
  });

  /** A claim still held after the window is a driver genuinely running, and the refusal is the answer. */
  it('gives up with the refusal once the window has passed', async () => {
    const claim = vi.fn(async () => { throw conflict(); });

    await expect(_claimDrive({ claim }, 250)).rejects.toThrow(/already claimed/);

    expect(claim.mock.calls.length, 'it retried rather than failing at once').toBeGreaterThan(1);
  });

  /**
   * The firing case for branching on the code rather than the prose: anything that is not a conflict is a
   * real failure, and retrying one for ten seconds turns a wrong token into a timeout.
   */
  it('does not retry a failure that is not a conflict', async () => {
    const claim = vi.fn(async () => { throw new Error('the socket is gone'); });

    await expect(_claimDrive({ claim }, 5_000)).rejects.toThrow('the socket is gone');

    expect(claim).toHaveBeenCalledOnce();
  });
});
