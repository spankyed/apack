// An ask in a component: `useAsk` makes it, says while it is under way, and keeps how the latest one ended. An earlier
// ask still under way when another is made, or when the component goes, has its answer ignored.
import { describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { useAsk } from '../../src/fe/use-ask.ts';

type Outcome = { ok: true; value: string } | { ok: false; failure: { kind: string; message: string } };

/** An ask whose answers a case gives, in whatever order it likes */
function asks() {
  const waiting: Array<(outcome: Outcome) => void> = [];
  return { run: (_name: string) => new Promise<Outcome>((resolve) => { waiting.push(resolve); }), answer: (index: number, outcome: Outcome) => waiting[index]!(outcome) };
}

const inScope = <T>(make: () => T) => {
  const scope = effectScope();
  return { value: scope.run(make)!, stop: () => scope.stop() };
};

describe('useAsk', () => {
  it('is pending while its ask is under way, and keeps how it ended', async () => {
    const { run, answer } = asks();
    const { value: rename } = inScope(() => useAsk(run));
    const asking = rename.ask('Notes');
    expect(rename.pending).toBe(true);
    answer(0, { ok: true, value: 'Notes' });
    expect(await asking).toEqual({ ok: true, value: 'Notes' });
    expect(rename.pending).toBe(false);
    expect(rename.outcome).toEqual({ ok: true, value: 'Notes' });
  });

  it('keeps the latest ask, whichever is answered first', async () => {
    const { run, answer } = asks();
    const { value: rename } = inScope(() => useAsk(run));
    const first = rename.ask('First');
    const second = rename.ask('Second');
    answer(1, { ok: true, value: 'Second' });
    await second;
    answer(0, { ok: false, failure: { kind: 'failed', message: 'too late' } });
    await first;
    expect(rename.outcome).toEqual({ ok: true, value: 'Second' });
    expect(rename.pending).toBe(false);
  });

  it('takes nothing once its component has gone', async () => {
    const { run, answer } = asks();
    const { value: rename, stop } = inScope(() => useAsk(run));
    const asking = rename.ask('Notes');
    stop();
    answer(0, { ok: true, value: 'Notes' });
    await asking;
    expect(rename.outcome).toBeUndefined();
  });

  it('refuses to be called outside a component', () => {
    expect(() => useAsk(async () => ({ ok: true, value: '' }))).toThrow("called in a component's setup");
  });
});
