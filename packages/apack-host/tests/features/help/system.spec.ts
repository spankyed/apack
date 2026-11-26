import { afterEach, describe, expect, it } from 'vitest';
import { system } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import { isState } from '@apackdev/sdk/framework';
import { startTestRuntime, testPacks } from '@apackdev/sdk/testing';
import { createNativePackTestRegistry } from '@apackdev/host/testing';
import { HOST_ENTITY_TYPES } from '../../../src/app-state/index.ts';
import { helpSystem } from '../../../src/features/help/be/system.ts';

const registry = createNativePackTestRegistry();
startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: registry });

afterEach(() => {
  testPacks.help.delete('help-unit-pack');
  try { registry.unregisterPack('help-unit-pack'); } catch {}
});

describe('host help system (@apackdev/state)', () => {
  it('broadcasts HELP_CATALOG on GET_HELP, CLIENT_CONNECTED, and catalog changes, and unsubscribes on exit', () => {
    expect(isState(helpSystem)).toBe(true);
    const sent: Array<{ to: string; event: { type: string; catalog?: { articles: Array<{ packId: string }> } } }> = [];

    {
      using guard = defectGuard();
      using sys = system({ side: 'backend', onDefect: guard.onDefect });
      sys.attach({
        tell: (to, event) => { sent.push({ to, event: event as typeof sent[number]['event'] }); },
        ask: (_to, _name, _args, _progress, done) => {
          done({ ok: false, failure: { kind: 'unavailable', message: 'unused' } });
          return () => {};
        },
        follow: (_feature, _view, _args, _updated, failed) => {
          failed({ kind: 'unavailable', message: 'unused' });
          return { stop: () => {} };
        },
      });
      const handle = sys.start('host/help', helpSystem);

      sys.send(handle, { type: 'GET_HELP' });
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe('host/settings');
      expect(sent[0].event.type).toBe('HELP_CATALOG');

      sys.send(handle, { type: 'CLIENT_CONNECTED' });
      expect(sent).toHaveLength(2);
      expect(sent[1].to).toBe('host/settings');
      expect(sent[1].event.type).toBe('HELP_CATALOG');

      testPacks.help.set('help-unit-pack', [
        { packId: 'help-unit-pack', packName: 'Unit', id: 'intro', title: 'Intro', body: 'Body' },
      ]);
      registry.registerPack({ id: 'help-unit-pack', features: {} });
      expect(sent).toHaveLength(3);
      expect(sent[2].event.catalog?.articles.some((a) => a.packId === 'help-unit-pack')).toBe(true);

      guard.assertNone();
    }

    // After disposal, catalog changes must not deliver more broadcasts (onExit unsubscribed).
    const countAfterStop = sent.length;
    testPacks.help.delete('help-unit-pack');
    registry.unregisterPack('help-unit-pack');
    expect(sent).toHaveLength(countAfterStop);
  });
});
