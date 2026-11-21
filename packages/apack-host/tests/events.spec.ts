import { boundEars } from '@apackdev/sdk/ears';
// The app is the pack `host`, so its messages say so: a drop or an unroutable send names who made it instead of
// leaving that to a grep. The untyped sends below stamp nothing — a caller reaches for them deliberately, and
// nothing routes or refuses on the stamp — so absent is a sender with nothing to declare rather than a fault.
import { describe, expect, it } from 'vitest';
import type { Message } from '@apackdev/sdk/events';
import { untypedBroadcast, untypedTell } from '@apackdev/sdk/events';
import { startTestRuntime, testRootEvents } from '@apackdev/sdk/testing';
import { HOST_ENTITY_TYPES } from '../src/app-state/index.ts';
import { broadcast, tell } from '../src/events.ts';
import { HOST } from '../src/refs.ts';
import { createSettingsStore } from '../src/features/settings/be/store.ts';
import { createContributionCatalog } from '../src/packs/catalog.ts';
import { appSettingsDefinition } from '../src/features/settings/be/app-definition.ts';

startTestRuntime({ entityTypes: HOST_ENTITY_TYPES });
const catalog = createContributionCatalog(appSettingsDefinition);
const snapshot = createSettingsStore({ ears: boundEars, catalog: () => catalog.settings() }).getSnapshot();

/** What a send emitted, whichever direction it went */
function emitted(send: () => void, listen: 'surface' | 'system'): Message[] {
  const seen: Message[] = [];
  const stop = listen === 'surface'
    ? testRootEvents.onSurfaceSend((message) => seen.push(message))
    : testRootEvents.onIncoming((message) => seen.push(message));
  try {
    send();
  } finally {
    stop();
  }
  return seen;
}

describe('the host sends as itself', () => {
  it('stamps a send to one of its own surfaces, named as a pack names its own', () => {
    expect(emitted(() => broadcast('settings', { type: 'SETTINGS_LOADED', snapshot }), 'surface'))
      .toEqual([{ to: HOST.settings, from: 'host', call: expect.any(String), event: { type: 'SETTINGS_LOADED', snapshot } }]);
  });

  it('stamps a send to one of its own systems', () => {
    expect(emitted(() => tell('packs', { type: 'GET_INSTALLED_PACKS' }), 'system'))
      .toEqual([{ to: HOST.packs, from: 'host', call: expect.any(String), event: { type: 'GET_INSTALLED_PACKS' } }]);
  });

  // The unbound sends take a ref and check nothing: they are what an action reaches through `services.emitter`
  it('leaves a send made outside a pack unstamped, and unchecked', () => {
    expect(emitted(() => untypedBroadcast(HOST.settings, { type: 'SETTINGS_LOADED' }), 'surface'))
      .toEqual([{ to: HOST.settings, call: expect.any(String), event: { type: 'SETTINGS_LOADED' } }]);
    expect(emitted(() => untypedTell(HOST.packs, { type: 'GET_PACKS' }), 'system'))
      .toEqual([{ to: HOST.packs, call: expect.any(String), event: { type: 'GET_PACKS' } }]);
  });

  /** The map is the check: a name nothing declares, and an event that surface doesn't take, are both compile errors */
  it('refuses a feature it has none of, and an event that feature does not take', () => {
    // @ts-expect-error the host has no `nope` feature
    expect(() => broadcast('nope', { type: 'SETTINGS_LOADED', snapshot })).toBeDefined();
    // @ts-expect-error the packs view doesn't take a settings event
    expect(() => broadcast('packs', { type: 'SETTINGS_LOADED', snapshot })).toBeDefined();
  });
});
