// Preferences reset independently of onboarding and pack lifecycle state.
import { describe, expect, it } from 'vitest';
import { type EARS } from '@apackdev/sdk';
import { untypedWrite, untypedQuery } from '@apackdev/sdk/ears';
import { getTestSettings, startApp } from '@apackdev/testing/harness';
import { featureSettings } from '#generated/settings.ts';
import { services } from '#generated/services.ts';

const APP_STATE_ID = 'AppState-app' as EARS.EntityId;

describe('resetting settings', () => {
  it("keeps the app's own state", async () => {
    const app = await startApp({ systems: ['host/settings'] });
    await app.connect();
    services.onboarding.complete();
    untypedWrite(APP_STATE_ID).set('packVersions', { 'memo-pack': '1.2.0' }).set('failedAgainst', { 'memo-pack': 'provider:' });
    featureSettings.forFeature('threads').set({ path: ['recentThreadsSortOrder'], value: 'created' });

    const call = await app.send('host/settings', { type: 'RESET_ALL_SETTINGS' }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
    await app.nextEmit('host/settings', 'ASK_ANSWERED', { answering: call });

    expect(featureSettings.forFeature('threads').get()).not.toMatchObject({ recentThreadsSortOrder: 'created' });
    expect(untypedQuery.ids(APP_STATE_ID).pickOne(['hasOnboarded', 'packVersions', 'failedAgainst'])).toMatchObject({
      hasOnboarded: true,
      packVersions: { 'memo-pack': '1.2.0' },
      failedAgainst: { 'memo-pack': 'provider:' },
    });
    expect(services.onboarding.isComplete()).toBe(true);
  });
});
