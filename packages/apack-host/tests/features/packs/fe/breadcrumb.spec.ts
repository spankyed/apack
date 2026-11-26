import { describe, expect, it } from 'vitest';
import { system } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import type { Surface } from '@apackdev/sdk/fe';
import { computeTrail } from '../../../../src/features/application/fe/chrome.ts';
import { computeCrumbs } from '../../../../src/features/application/fe/trail.ts';
import { createShell } from '../../../../src/fe/index.ts';
import packsState, { packsChrome } from '../../../../src/features/packs/fe/machine.ts';
import { fakeShell } from '../../application/fe/fakes.ts';

describe('the Packs tab', () => {
  it('reads "Packs" in the breadcrumb trail via computeTrail', () => {
    using guard = defectGuard();
    using sys = system({ side: 'window', onDefect: guard.onDefect });
    const handle = sys.start('host/packs', packsState);
    expect(computeTrail(packsChrome, sys.read(handle)).breadcrumbs.map((c) => c.label)).toEqual(['Packs']);
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
    const app = createShell(shell.options, { ownsLastActiveSurface: false }).start();
    try {
      const snap = app.system.read({ ref: 'host/packs' }) as { at?: string; data: unknown };
      expect(computeCrumbs({ id: 'host/packs', at: snap.at, data: snap.data, chrome: packsChrome }).crumbs.map((c) => c.label)).toEqual(['Packs']);
    } finally {
      app.stop();
    }
  });
});
