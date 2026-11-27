// `apack pack dev` rebuilds a pack and asks the running app to reload it, over POST /dev/reload. For an
// external pack that reload can be the app's first sight of it — `apack pack dev` installs into a running
// app — so it has to leave the pack running. The repo's own dev-reload spec covers the built-in path;
// this is the external one, against the real endpoint.
import { test, expect } from '@apackdev/testing';

const PACK_ID = 'e2e-fixture';

test('a reloaded pack is left running', async ({ app, appPage, connection }) => {
  await app.waitForSurface('memos');
  const previous = await appPage.evaluate(packId => {
    const shell = (window as any).applicationState;
    return { runtime: shell.getSnapshot().context.acceptedPackRuntimes[packId],
      actor: shell.surface(`${packId}/memos`).sessionId };
  }, PACK_ID);

  await connection.reloadPack(PACK_ID);

  // The endpoint commits the backend; frontend acceptance and actor handoff follow asynchronously.
  await expect.poll(() => appPage.evaluate(({ packId, previous }) => {
    const current = (window as any).applicationState.getSnapshot().context.acceptedPackRuntimes[packId];
    return !!current && current !== previous;
  }, { packId: PACK_ID, previous: previous.runtime })).toBe(true);
  const actor = await appPage.evaluate(packId =>
    (window as any).applicationState.surface(`${packId}/memos`).sessionId, PACK_ID);
  expect(actor).not.toBe(previous.actor);

  // Interacting with the accepted frontend also proves its cached canvas has rebound to the fresh actor.
  await app.navigate('memos');
  const text = `memo after reload ${Date.now()}`;
  await appPage.getByTestId('memo-input').fill(text);
  await appPage.getByTestId('memo-add').click();
  await expect(appPage.getByTestId('memo-list').getByText(text, { exact: true })).toBeVisible();
});
