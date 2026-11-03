// The chain's scheduler, against a fake runner. A scheduler fails in ways a passing timing run cannot show:
// it can leak budget, keep dispatching after a failure, run two conflicting steps at once, or simply
// never return. Each of those is a case here, and none of them is visible from a green `npm run chain`.
import { describe, expect, it } from 'vitest';
import { schedule, type SchedulableStep } from '../../../scripts/lib/chain-schedule.ts';
import { coresFor } from '../../../scripts/lib/core-budget.ts';

const step = (name: string, dependsOn: string[] = [], extra: Partial<SchedulableStep> = {}): SchedulableStep =>
  ({ name, dependsOn, ...extra });

/** A runner that records concurrency and finishes a step when told, so ordering is asserted rather than timed */
function runner(failing: string[] = []) {
  const release = new Map<string, () => void>();
  const order: string[] = [];
  let live = 0;
  let peak = 0;
  // Beside `peak`, because a budget is about what the live steps *take* and a count cannot say it: three
  // one-core steps and one three-core step are the same peak and a different machine
  let liveCores = 0;
  let peakCores = 0;
  const run = (s: SchedulableStep): Promise<boolean> => {
    order.push(s.name);
    live += 1;
    peak = Math.max(peak, live);
    liveCores += s.cores ?? 1;
    peakCores = Math.max(peakCores, liveCores);
    return new Promise<boolean>((resolve) => release.set(s.name, () => {
      live -= 1;
      liveCores -= s.cores ?? 1;
      resolve(!failing.includes(s.name));
    }));
  };
  /** Lets every step that has started and not finished complete, repeatedly, until the run settles */
  const drain = async (): Promise<void> => {
    for (let i = 0; i < 50 && release.size > 0; i += 1) {
      // The copy is the point: `done()` resolves a promise whose continuation writes back into `release`.
      // eslint-disable-next-line no-useless-spread
      for (const [name, done] of [...release]) { release.delete(name); done(); }
      await new Promise((r) => setImmediate(r));
    }
  };
  return { run, drain, order, peak: () => peak, peakCores: () => peakCores, live: () => live };
}

const never = (): boolean => false;

describe('schedule', () => {
  it('runs one at a time in dependency order at a budget of one', async () => {
    const r = runner();
    const steps = [step('a'), step('b', ['a']), step('c', ['b'])];
    const done = schedule({ steps, budget: 1, skip: never, run: r.run });
    await r.drain();
    await done;
    expect(r.order).toEqual(['a', 'b', 'c']);
    expect(r.peak()).toBe(1);
  });

  it('runs independent steps together, up to the budget', async () => {
    const r = runner();
    const steps = [step('a'), step('b'), step('c'), step('d')];
    const done = schedule({ steps, budget: 2, skip: never, run: r.run });
    await r.drain();
    await done;
    expect(r.peak()).toBe(2);
    expect(r.order.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it.each(['test:external-pack:fork', 'test:external-pack:contract', 'test:packaged-authoring:author'])(
    'reserves the full pack-build width for %s on a two-core budget', async name => {
      const r = runner();
      const cores = coresFor(name, 10);
      expect(cores).toBe(coresFor('build:default-setup', 10));
      const done = schedule({ steps: [step(name, [], { cores }), step('other')],
        budget: 2, skip: never, run: r.run });
      await r.drain();
      await done;
      expect(r.peak()).toBe(1);
    });

  it('reserves both cores for the pack typecheck', async () => {
    const r = runner();
    const cores = coresFor('typecheck:pack', 10);
    expect(cores).toBe(2);
    const done = schedule({ steps: [step('typecheck:pack', [], { cores }), step('other')],
      budget: 2, skip: never, run: r.run });
    await r.drain();
    await done;
    expect(r.peak()).toBe(1);
  });

  it('never runs a step beside one it conflicts with', async () => {
    const r = runner();
    // All three are ready at once, and `lock` names both of the others
    const steps = [step('lock', [], { conflicts: ['a', 'b'] }), step('a'), step('b')];
    const done = schedule({ steps, budget: 3, skip: never, run: r.run });
    await r.drain();
    await done;
    expect(r.order[0]).toBe('lock');
    expect(r.peak()).toBe(2); // lock alone, then a and b together
  });

  /**
   * A mutex is symmetric, and the derivation is not the scheduler's to trust: here only `a` names `lock`,
   * and the pair must still not overlap. A one-sided conflict that let them run together would be a race
   * nothing in a timing run would show.
   */
  it('keeps a pair apart when only one of them names the other', async () => {
    const r = runner();
    const steps = [step('lock'), step('a', [], { conflicts: ['lock'] })];
    const done = schedule({ steps, budget: 2, skip: never, run: r.run });
    await r.drain();
    await done;
    expect(r.peak()).toBe(1);
  });

  it('holds a conflicting step until the budget is free', async () => {
    const r = runner();
    const steps = [step('a'), step('b'), step('lock', [], { conflicts: ['a', 'b'] })];
    const done = schedule({ steps, budget: 2, skip: never, run: r.run });
    await r.drain();
    await done;
    expect(r.order).toEqual(['a', 'b', 'lock']);
    expect(r.peak()).toBe(2);
  });

  // `ready` depends on nothing, so it is dispatchable the moment the budget frees up. That is what makes this a
  // test of the failure guard: a step that merely *needed* the failed one would never be ready anyway, and
  // such a test passes with the guard deleted — measured.
  it('stops dispatching a ready step once something has failed', async () => {
    const r = runner(['a']);
    const steps = [step('a'), step('ready')];
    const done = schedule({ steps, budget: 1, skip: never, run: r.run });
    await r.drain();
    const outcome = await done;
    expect(outcome.failed).toBe('a');
    expect(r.order).toEqual(['a']);
  });

  it('never runs a step whose dependency failed', async () => {
    const r = runner(['a']);
    const steps = [step('a'), step('needs-a', ['a'])];
    const done = schedule({ steps, budget: 2, skip: never, run: r.run });
    await r.drain();
    await done;
    expect(r.order).toEqual(['a']);
  });

  it('awaits the steps already running when one fails, leaving nothing in flight', async () => {
    const r = runner(['a']);
    const steps = [step('a'), step('b'), step('c', ['b'])];
    const done = schedule({ steps, budget: 2, skip: never, run: r.run });
    await r.drain();
    await done;
    expect(r.live()).toBe(0);
  });

  it('returns rather than hanging when the rest of the graph is unreachable', async () => {
    const r = runner(['a']);
    const steps = [step('a'), step('b', ['a']), step('c', ['b'])];
    const done = schedule({ steps, budget: 1, skip: never, run: r.run });
    await r.drain();
    // The assertion is that this resolves at all: a scheduler that waits on `waiting` emptying would hang
    await expect(done).resolves.toMatchObject({ failed: 'a' });
  });

  // A rejected `run` used to escape the loop at once: the sibling in flight was abandoned, its step finished
  // unobserved, and the caller died on an unhandled rejection with child processes still alive.
  it('treats a thrown step as a failed one, and still drains what ran beside it', async () => {
    const order: string[] = [];
    let siblingFinished = false;
    const done = schedule({
      steps: [step('boom'), step('sibling')],
      budget: 2,
      skip: never,
      run: async (s) => {
        order.push(s.name);
        if (s.name === 'boom') throw new Error('the runner threw');
        await new Promise((r) => setTimeout(r, 5));
        siblingFinished = true;
        return true;
      },
    });
    const outcome = await done;
    expect(outcome.failed).toBe('boom');
    expect(outcome.threw).toHaveLength(1);
    expect((outcome.threw[0].error as Error).message).toBe('the runner threw');
    expect(outcome.threw[0].step).toBe('boom');
    expect(siblingFinished, 'the step beside it was awaited, not abandoned').toBe(true);
    expect(order).toEqual(['boom', 'sibling']);
  });

  it('reports no throws when every step merely passes or fails', async () => {
    const r = runner(['a']);
    const done = schedule({ steps: [step('a')], budget: 1, skip: never, run: r.run });
    await r.drain();
    expect((await done).threw).toEqual([]);
  });

  it('admits on what the steps take together, not on how many there are', async () => {
    const r = runner();
    // Four cores each and ten to spend: two fit and the third does not, which a count of steps could not say
    const steps = [step('a', [], { cores: 4 }), step('b', [], { cores: 4 }), step('c', [], { cores: 4 })];
    const done = schedule({ steps, budget: 10, skip: never, run: r.run });
    await r.drain();
    await done;
    expect(r.peakCores()).toBe(8);
    expect(r.peak()).toBe(2);
    expect(r.order.sort()).toEqual(['a', 'b', 'c']);
  });

  it('lets a step past one that does not fit, rather than holding the queue behind it', async () => {
    const r = runner();
    // `first` takes a core, which is what puts `wide` over a budget of five — and `wide` sorts ahead of
    // `small` in the table. Breaking there would dispatch `small` only after `wide` had run on its own,
    // giving the order `first, wide, small` and never two steps at once.
    const steps = [step('first'), step('wide', [], { cores: 9 }), step('small')];
    const done = schedule({ steps, budget: 5, skip: never, run: r.run });
    await r.drain();
    await done;
    expect(r.order).toEqual(['first', 'small', 'wide']);
    expect(r.peak()).toBe(2);
  });

  it('frees what a step held when it finishes, so a budget is not leaked', async () => {
    const r = runner();
    const steps = [step('a', [], { cores: 9 }), step('b', [], { cores: 9 })];
    const done = schedule({ steps, budget: 10, skip: never, run: r.run });
    await r.drain();
    await done;
    // Both ran, and never together: a leak would show as neither
    expect(r.order.sort()).toEqual(['a', 'b']);
    expect(r.peak()).toBe(1);
  });

  it('runs a step wider than the whole budget rather than never running it', async () => {
    const r = runner();
    const steps = [step('huge', [], { cores: 20 }), step('a')];
    const done = schedule({ steps, budget: 10, skip: never, run: r.run });
    await r.drain();
    await done;
    // The budget is soft for exactly this: a hard comparison would skip it and the chain would pass over it
    expect(r.order.sort()).toEqual(['a', 'huge']);
  });

  it('restricts nothing when the budget is larger than everything', async () => {
    const r = runner();
    const steps = [step('a', [], { cores: 9 }), step('b', [], { cores: 9 })];
    const done = schedule({ steps, budget: 100, skip: never, run: r.run });
    await r.drain();
    await done;
    expect(r.peak()).toBe(2);
    expect(r.peakCores()).toBe(18);
  });

  it('costs a skipped step no budget, and unblocks what needed it', async () => {
    const r = runner();
    const steps = [step('a'), step('b', ['a']), step('c', ['b'])];
    const done = schedule({ steps, budget: 1, skip: (s) => s.name !== 'c', run: r.run });
    await r.drain();
    const outcome = await done;
    expect(outcome.skipped).toEqual(['a', 'b']);
    expect(r.order).toEqual(['c']);
  });
});

describe('a step that has to wait for something outside the graph', () => {
  const never = () => false;
  const gate = (open: () => boolean, pauses: { n: number } = { n: 0 }, left: string[] = []) => ({
    admit: () => open(),
    leave: (s: SchedulableStep) => { left.push(s.name); },
    pause: async () => { pauses.n++; await new Promise((resolve) => setImmediate(resolve)); },
  });

  it('holds no budget while it waits, so the steps it would have blocked run past it', async () => {
    const order: string[] = [];
    let open = false;
    const admission = { ...gate(() => open), admit: (s: SchedulableStep) => s.name !== 'wide' || open };
    const result = await schedule({
      steps: [step('wide', [], { cores: 5 }), step('cheap', [], { cores: 5 })], budget: 5, skip: never, admission,
      run: async (s) => { order.push(s.name); if (s.name === 'cheap') open = true; return true; },
    });
    expect(order).toEqual(['cheap', 'wide']);
    expect(result.failed).toBeUndefined();
  });

  it('never starts it once something has failed, and doesn\'t wait for it', async () => {
    const admission = { ...gate(() => false), admit: (s: SchedulableStep) => s.name !== 'wide' };
    const ran: string[] = [];
    const result = await schedule({
      steps: [step('wide'), step('fails')], budget: 2, skip: never, admission,
      run: async (s) => { ran.push(s.name); return false; },
    });
    expect(ran).toEqual(['fails']);
    expect(result.failed).toBe('fails');
    expect(result.started).toEqual(['fails']);
  });

  it('keeps asking while nothing else runs, and asks whether to skip it once', async () => {
    let asked = 0, skips = 0;
    const pauses = { n: 0 };
    const result = await schedule({
      steps: [step('wide')], budget: 1, admission: gate(() => ++asked === 4, pauses),
      skip: () => { skips++; return false; }, run: async () => true,
    });
    expect(result.started).toEqual(['wide']);
    expect(pauses.n).toBe(3);
    expect(skips).toBe(1);
  });

  it('tells of each step that ended, passing, failing or throwing', async () => {
    const ended: string[] = [];
    await schedule({
      steps: [step('passes'), step('fails'), step('throws')], budget: 3, skip: never,
      admission: gate(() => true, { n: 0 }, ended),
      run: async (s) => { if (s.name === 'throws') throw new Error('no'); return s.name === 'passes'; },
    });
    expect(ended.sort()).toEqual(['fails', 'passes', 'throws']);
  });

  it('fails a step whose admission throws, and leaves what is running to finish', async () => {
    const refused = new Error('a lock it will not wait for');
    let finished = false;
    const result = await schedule({
      steps: [step('running'), step('refused')], budget: 2, skip: never,
      admission: { ...gate(() => true), admit: (s: SchedulableStep) => { if (s.name === 'refused') throw refused; return true; } },
      run: async () => { await new Promise((resolve) => setImmediate(resolve)); finished = true; return true; },
    });
    expect(finished).toBe(true);
    expect(result.failed).toBe('refused');
    expect(result.threw).toEqual([{ step: 'refused', error: refused }]);
  });
});

