import { describe, expect, expectTypeOf, it } from 'vitest';
import { forNet, state, type Asks, type Net } from '@apackdev/state';
import type {
  AskAnswered,
  ASK_CANCELLED,
  ContractAsks,
  HostSystemAsksOf,
  IncomingOnlyEventsOf,
  NormalizeAsk,
  NormalizeAsks,
} from '../../src/events/index.ts';
import {
  defineViews,
  type HostLifecycleEvents,
  type NetView,
  type NetViews,
  type StateMatchesContract,
} from '../../src/framework/index.ts';

describe('@apackdev/state contract normalizers and StateMatchesContract', () => {
  it('normalizes optional AskDeclaration fields to @apackdev/state AskShape', () => {
    type RawAsks = {
      EMPTY: {};
      ARGS_ONLY: { args: { id: string } };
      ANSWER_ONLY: { answer: { ok: boolean } };
      FULL: { args: { q: string }; answer: number; refuses: { 'not-found': {} }; progress: { count: number } };
    };
    type Normalized = NormalizeAsks<RawAsks>;

    expectTypeOf<Normalized>().toExtend<Asks>();
    expectTypeOf<Normalized['EMPTY']>().toEqualTypeOf<{ args: {}; answer: void }>();
    expectTypeOf<Normalized['ARGS_ONLY']>().toEqualTypeOf<{ args: { id: string }; answer: void }>();
    expectTypeOf<Normalized['ANSWER_ONLY']>().toEqualTypeOf<{ args: {}; answer: { ok: boolean } }>();
    expectTypeOf<Normalized['FULL']['args']>().toEqualTypeOf<{ q: string }>();
    expectTypeOf<Normalized['FULL']['answer']>().toEqualTypeOf<number>();
    expectTypeOf<Normalized['FULL']['refuses']>().toEqualTypeOf<{ 'not-found': {} }>();
    expectTypeOf<Normalized['FULL']['progress']>().toEqualTypeOf<{ count: number }>();
    expectTypeOf<NormalizeAsks<never>>().toEqualTypeOf<{}>();
    expectTypeOf<NormalizeAsk<{ args: { n: number }; refuses: 'bad' }>['refuses']>().toEqualTypeOf<'bad'>();
    expectTypeOf<HostSystemAsksOf<'host/bus'>>().toEqualTypeOf<{}>();
  });

  it('normalizes defineViews zero-arg views to args: {} for Net["views"]', () => {
    const views = defineViews({
      all: () => ['a', 'b'],
      byId: ({ id }: { id: string }) => ({ id }),
    });
    type Normalized = NetViews<typeof views>;

    expectTypeOf<Normalized>().toExtend<Net['views'][string]>();
    expectTypeOf<NetView<typeof views.all>>().toEqualTypeOf<{ args: {}; result: string[] }>();
    expectTypeOf<NetView<typeof views.byId>>().toEqualTypeOf<{ args: { id: string }; result: { id: string } }>();
    expectTypeOf<NetViews<never>>().toEqualTypeOf<{}>();
  });

  it('extracts tell-only IncomingOnlyEventsOf without asks or internal events', () => {
    type Contract = {
      incoming: { type: 'PING'; n: number };
      asks: { GET: { args: { id: string }; answer: string } };
      internal: { type: 'SELF' };
      outgoing: { type: 'PONG' };
    };
    expectTypeOf<IncomingOnlyEventsOf<Contract>>().toEqualTypeOf<{ type: 'PING'; n: number }>();
    expectTypeOf<IncomingOnlyEventsOf<{ outgoing: { type: 'PONG' } }>>().toEqualTypeOf<never>();
    expectTypeOf<IncomingOnlyEventsOf<never>>().toEqualTypeOf<never>();
  });

  it('validates StateMatchesContract bidirectionally with opt-in HostLifecycleEvents', () => {
    type Contract = {
      incoming: { type: 'PING'; id: string };
      asks: {
        GET: { args: { id: string }; answer: { title: string } };
        FLUSH: {};
      };
      internal: { type: 'SELF_TICK' };
      outgoing: { type: 'PONG' };
    };
    type NormalizedAsks = NormalizeAsks<ContractAsks<Contract>>;

    const exact = state<
      { internal: { type: 'SELF_TICK' } },
      { type: 'PING'; id: string },
      NormalizedAsks
    >()({
      answers: {
        GET: (args) => ({ title: args.id }),
        FLUSH: () => {},
      },
      on: { PING: () => {} },
    });

    const withLifecycle = state<
      {},
      { type: 'PING'; id: string } | Extract<HostLifecycleEvents, { type: 'SEND_STATE' | 'FEATURE_SETTINGS_UPDATED' }>,
      NormalizedAsks
    >()({
      answers: {
        GET: (args) => ({ title: args.id }),
        FLUSH: () => {},
      },
      on: { PING: () => {}, SEND_STATE: () => {}, FEATURE_SETTINGS_UPDATED: () => {} },
    });

    const withInternalReports = state<
      {},
      { type: 'PING'; id: string } | { type: 'SELF_TICK' },
      NormalizedAsks
    >()({
      answers: {
        GET: (args) => ({ title: args.id }),
        FLUSH: () => {},
      },
      on: { PING: () => {}, SELF_TICK: () => {} },
    });

    const missingEvent = state<{}, never, NormalizedAsks>()({
      answers: {
        GET: (args) => ({ title: args.id }),
        FLUSH: () => {},
      },
    });

    const extraEvent = state<{}, { type: 'PING'; id: string } | { type: 'ROGUE' }, NormalizedAsks>()({
      answers: {
        GET: (args) => ({ title: args.id }),
        FLUSH: () => {},
      },
      on: { PING: () => {}, ROGUE: () => {} },
    });

    const leakedWireEvent = state<{}, { type: 'PING'; id: string } | AskAnswered | { type: typeof ASK_CANCELLED }, NormalizedAsks>()({
      answers: {
        GET: (args) => ({ title: args.id }),
        FLUSH: () => {},
      },
      on: { PING: () => {}, ASK_ANSWERED: () => {}, ASK_CANCELLED: () => {} },
    });

    const missingAsk = state<{}, { type: 'PING'; id: string }, Pick<NormalizedAsks, 'GET'>>()({
      answers: { GET: (args) => ({ title: args.id }) },
      on: { PING: () => {} },
    });

    const extraAsk = state<{}, { type: 'PING'; id: string }, NormalizedAsks & { EXTRA: { args: {}; answer: void } }>()({
      answers: {
        GET: (args) => ({ title: args.id }),
        FLUSH: () => {},
        EXTRA: () => {},
      },
      on: { PING: () => {} },
    });

    type AskOnlyContract = {
      asks: { PING: {} };
      outgoing: { type: 'DONE' };
    };
    const askOnlyNoEvents = state<{}, never, NormalizeAsks<ContractAsks<AskOnlyContract>>>()({
      answers: { PING: () => {} },
    });
    const askOnlyWithLifecycle = state<{}, Extract<HostLifecycleEvents, { type: 'SEND_STATE' }>, NormalizeAsks<ContractAsks<AskOnlyContract>>>()({
      answers: { PING: () => {} },
      on: { SEND_STATE: () => {} },
    });

    expectTypeOf<StateMatchesContract<typeof exact, Contract>>().toEqualTypeOf<true>();
    expectTypeOf<StateMatchesContract<typeof withLifecycle, Contract>>().toEqualTypeOf<true>();
    expectTypeOf<StateMatchesContract<typeof withInternalReports, Contract>>().toEqualTypeOf<true>();
    expectTypeOf<StateMatchesContract<typeof askOnlyNoEvents, AskOnlyContract>>().toEqualTypeOf<true>();
    expectTypeOf<StateMatchesContract<typeof askOnlyWithLifecycle, AskOnlyContract>>().toEqualTypeOf<true>();

    expectTypeOf<StateMatchesContract<typeof missingEvent, Contract>>().not.toEqualTypeOf<true>();
    expectTypeOf<StateMatchesContract<typeof extraEvent, Contract>>().not.toEqualTypeOf<true>();
    expectTypeOf<StateMatchesContract<typeof leakedWireEvent, Contract>>().not.toEqualTypeOf<true>();
    expectTypeOf<StateMatchesContract<typeof missingAsk, Contract>>().not.toEqualTypeOf<true>();
    expectTypeOf<StateMatchesContract<typeof extraAsk, Contract>>().not.toEqualTypeOf<true>();
    expectTypeOf<StateMatchesContract<{ machine: unknown }, Contract>>().not.toEqualTypeOf<true>();

    // Runtime check for forNet(resolve) bare-to-qualified resolution
    const packState = forNet<{ systems: {}; surfaces: {}; views: {} }>(
      (name) => (name.includes('/') ? name : `demo-pack/${name}`),
    );
    const created = packState<{}, never>()({});
    expect(created.resolve?.('notes')).toBe('demo-pack/notes');
    expect(created.resolve?.('base-pack/memos')).toBe('base-pack/memos');
    expect(created.resolve?.('host/bus')).toBe('host/bus');
  });
});
