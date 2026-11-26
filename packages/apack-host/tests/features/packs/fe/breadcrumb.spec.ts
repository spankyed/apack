import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { system } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import type { Surface } from '@apackdev/sdk/fe';
import { computeTrail } from '../../../../src/features/application/fe/chrome.ts';
import { computeCrumbs } from '../../../../src/features/application/fe/trail.ts';
import { createShellMachine } from '../../../../src/fe/index.ts';
import packsState, { packsChrome } from '../../../../src/features/packs/fe/machine.ts';
import { fakeShell } from '../../application/fe/fakes.ts';

describe('the Packs tab', () => {
  it('reads "Packs" in the breadcrumb trail via computeTrail', () => {
    using guard = defectGuard();
    using sys = system({ side: 'window', onDefect: guard.onDefect });
    const handle = sys.start('host/packs', packsState);
    expect(computeTrail(packsChrome, sys.read(handle)).breadcrumbs.map(c => c.label)).toEqual(['Packs']);
  });

  it('reads "Packs" in the breadcrumb trail inside the shell', () => {
    const packsSurface = {
      id: 'host/packs',
      label: 'Packs',
      icon: 'Package',
      state: packsState,
      chrome: packsChrome,
      canvas: {},
    } as unknown as Surface;
    const shell = fakeShell({ surfaces: [packsSurface] });
    const app = createActor(createShellMachine(shell.options), {
      systemId: 'host/application',
      input: { ownsLastActiveSurface: false },
    }).start();
    try {
      const packsActor = app.system.get('host/packs')!;
      expect(computeCrumbs(packsActor.getSnapshot()).crumbs.map(c => c.label)).toEqual(['Packs']);
    } finally {
      app.stop();
    }
  });
});
