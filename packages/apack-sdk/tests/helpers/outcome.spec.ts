import { describe, expect, it } from 'vitest';
import { assign, createActor, setup, waitFor } from 'xstate';
import { done, failed, fromOutcome, onOutcome, outcomeOf, type Outcome } from '../../src/helpers/index.ts';

type Fetched = Outcome<string, { kind: 'missing'; path: string } | { kind: 'busy' }>;

/** A machine that invokes work answering `answer`, and records which branch it took and what the branch read */
function machineOver(answer: () => Promise<Fetched>) {
  return setup({
    types: { context: {} as { took: string | null; read: unknown } },
    actors: { fetch: fromOutcome(answer) },
    actions: {
      took: assign({ took: (_, params: { branch: string }) => params.branch }),
      readOutcome: assign({ read: ({ event }) => outcomeOf<Fetched>(event) }),
    },
  }).createMachine({
    context: { took: null, read: null },
    initial: 'fetching',
    states: {
      fetching: {
        invoke: {
          src: 'fetch',
          onDone: onOutcome<Fetched>()({
            done: { target: 'settled', actions: [{ type: 'took', params: { branch: 'done' } }, 'readOutcome'] },
            failed: {
              missing: { target: 'settled', actions: [{ type: 'took', params: { branch: 'missing' } }, 'readOutcome'] },
              busy: { target: 'settled', actions: { type: 'took', params: { branch: 'busy' } } },
            },
          }),
          onError: { target: 'settled', actions: assign({ took: 'error' }) },
        },
      },
      settled: { type: 'final' },
    },
  });
}

async function settle(answer: () => Promise<Fetched>) {
  const actor = createActor(machineOver(answer)).start();
  return (await waitFor(actor, (snapshot) => snapshot.status === 'done')).context;
}

describe('the transitions onOutcome writes', () => {
  it('takes the done branch for work that succeeded, which reads its value', async () => {
    expect(await settle(async () => done('contents'))).toEqual({ took: 'done', read: { ok: true, value: 'contents' } });
  });

  it('takes the branch of the kind the work failed as, which reads the failure whole', async () => {
    const failure = { kind: 'missing', path: '/nowhere' } as const;
    expect(await settle(async () => failed(failure))).toEqual({ took: 'missing', read: { ok: false, failure } });
  });

  it('tells one kind of failure from another', async () => {
    expect((await settle(async () => failed({ kind: 'busy' }))).took).toBe('busy');
  });

  it('leaves work that threw to onError: a failure nobody named is no outcome', async () => {
    expect((await settle(async () => { throw new Error('a bug'); })).took).toBe('error');
  });
});

describe('outcomeOf', () => {
  it('refuses an event that carries no outcome, naming it', () => {
    expect(() => outcomeOf<Fetched>({ type: 'SOMETHING_ELSE' })).toThrow('got SOMETHING_ELSE');
  });
});

// What the compiler holds a machine to. Never called: the subject is whether each call compiles
export function exhaustiveness(): void {
  // @ts-expect-error -- `busy` has no branch
  onOutcome<Fetched>()({ done: {}, failed: { missing: {} } });
  // @ts-expect-error -- `gone` is no kind the outcome names
  onOutcome<Fetched>()({ done: {}, failed: { missing: {}, busy: {}, gone: {} } });
}
