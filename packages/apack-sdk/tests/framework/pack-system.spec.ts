// A feature's system as its pack registers it: it accepts its declared incoming events and the shared lifecycle protocol.
import { describe, expect, it } from 'vitest';
import { state } from '@apackdev/state';
import { packSystem, SYSTEM_EVENT_TYPES } from '../../src/framework/index.ts';

const machine = state<{ data: Record<string, never> }, { type: 'ADD_MEMO' }>()({
  data: {},
  on: { ADD_MEMO: () => {} },
});

describe('packSystem', () => {
  it('uses declared inputs and the shared lifecycle protocol, without inferring its inbox from handlers', () => {
    expect(packSystem(machine, { incoming: ['SYNC', 'ADD_MEMO'] }))
      .toEqual({ machine, receives: ['SYNC', 'ADD_MEMO', ...SYSTEM_EVENT_TYPES] });
    expect(packSystem(machine, { incoming: [] }).receives).not.toContain('ADD_MEMO');
  });
});
