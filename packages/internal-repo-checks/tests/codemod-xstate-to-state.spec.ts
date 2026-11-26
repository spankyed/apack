import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codemodSource } from '../../../scripts/codemod-xstate-to-state.mts';

const repoRoot = resolve(import.meta.dirname, '../../..');

describe('codemod-xstate-to-state', () => {
  it('flags database/be/system.ts with BAIL_CLIENT_OR_ROLE and BAIL_EXTERNAL_HELPER_SENDS', () => {
    const file = resolve(repoRoot, 'packages/default-setup/src/features/database/be/system.ts');
    const result = codemodSource(file, readFileSync(file, 'utf8'));
    expect(result.status).toBe('BAIL-OUT');
    const rules = new Set(result.diagnostics.map((d) => d.rule));
    expect(rules.has('BAIL_CLIENT_OR_ROLE')).toBe(true);
    expect(rules.has('BAIL_EXTERNAL_HELPER_SENDS')).toBe(true);
  });

  it('converts a clean Wave 1 defineSystem machine and erases typeOf and { args } wrappers', () => {
    const sample = `
import { setup } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';
import type { Contract } from './contract.ts';

export const demoSpec = defineSystem<Contract>();

export const answers = demoSpec.answers({
  PING: () => ({ ok: true }),
  ECHO: ({ args }) => ({ text: args.text }),
  PICK: ({ args: { id } }) => ({ id }),
});

export const demoSystem = setup({
  types: demoSpec.types,
  actions: {
    ...answers.actions,
    ...demoSpec.actions({
      onInit: () => { console.log('init'); },
      onTouch: ({ event }) => {
        const ev = demoSpec.typeOf('TOUCH', event);
        console.log(ev.id);
      },
    }),
  },
}).createMachine({
  id: 'demo',
  initial: 'idle',
  context: () => ({}),
  on: {
    ...answers.on,
    TOUCH: { actions: 'onTouch' },
  },
  states: {
    idle: { entry: 'onInit' },
  },
});

const demoEntry = { spec: demoSpec, machine: demoSystem };
export default demoEntry;
`;
    const result = codemodSource('demo/system.ts', sample);
    expect(result.status).toBe('CONVERTIBLE');
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain("import { state } from '#generated/state.ts';");
    expect(result.output).not.toContain("'xstate'");
    expect(result.output).not.toContain('defineSystem');
    expect(result.output).toContain('run: () => { console.log(\'init\'); },');
    expect(result.output).toContain('TOUCH: (ev) => {');
    expect(result.output).toContain('ECHO: (args) => ({ text: args.text }),');
    expect(result.output).toContain('PICK: ({ id }) => ({ id }),');
    expect(result.output).toContain('export default demoSystem;');
  });

  it('refuses machines triggering BAIL_ACTION_CHAIN_READS_PRIOR_ASSIGN and BAIL_SIDE_EFFECT_IN_ASSIGN', () => {
    const sample = `
import { assign, setup } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';
import { broadcast } from '#generated/events.ts';
import type { Contract } from './contract.ts';

const spec = defineSystem<Contract>();
export const badSystem = setup({
  types: spec.types,
  actions: {
    bump: assign({ count: ({ context }) => { broadcast('demo', { type: 'BUMPED' }); return context.count + 1; } }),
    announce: ({ context }) => { console.log(context.count); },
  },
}).createMachine({
  id: 'bad',
  context: { count: 0 },
  on: {
    GO: { actions: ['bump', 'announce'] },
  },
});
`;
    const result = codemodSource('bad/system.ts', sample);
    expect(result.status).toBe('BAIL-OUT');
    const rules = new Set(result.diagnostics.map((d) => d.rule));
    expect(rules.has('BAIL_SIDE_EFFECT_IN_ASSIGN')).toBe(true);
    expect(rules.has('BAIL_ACTION_CHAIN_READS_PRIOR_ASSIGN')).toBe(true);
  });
});
