// A pack's surface runs under `<packId>/<featureId>`, so this pack's `notes` feature and
// default-setup's are two surfaces with two addresses, not one shadowing the other. Before that, the
// second pack to register a `notes` surface was dropped into the renderer console: it installed
// "successfully" with no UI, and every send to `notes` reached whichever pack registered first.
//
// **So this fixture's feature is named after a real default-setup one deliberately, and must stay.**
// Everywhere else a fictional feature takes a name no pack has (`memos`, `calendar`), because
// `features/notes` otherwise names an invention and a real feature at once. Here the collision is the
// subject: rename it and the suite still passes, over two addresses that were never going to clash.
import { test, expect } from '@apackdev/testing';

test('this pack and default-setup each get their own notes surface', async ({ app, appPage }) => {
  await app.waitForSurface('notes');

  const ids = await appPage.evaluate(() => {
    const surfaces: Array<{ id: string; label: string }> =
      (window as any).applicationState.getSnapshot().context.surfaces;
    return surfaces.filter((p) => p.id.endsWith('/notes')).map((p) => p.id).sort();
  });
  expect(ids).toEqual(['default-setup/notes', 'e2e-fixture/notes']);

  // Each address reaches its own surface's canvas, so neither is the other's
  await app.navigate('e2e-fixture/notes');
  await expect(appPage.getByTestId('fixture-notes-title')).toHaveText("the fixture's own notes");

  await app.navigate('default-setup/notes');
  await expect(appPage.getByTestId('fixture-notes-title')).toHaveCount(0);
});

// A spec names surfaces the way the pack it tests names them, so the short name is this pack's own
// feature even when a dependency has one too — the same rule `emit` and `broadcast` follow.
test("the short name is this pack's own surface, not its dependency's", async ({ app, appPage }) => {
  await app.navigate('notes');
  await expect(appPage.getByTestId('fixture-notes-title')).toBeVisible();
});
