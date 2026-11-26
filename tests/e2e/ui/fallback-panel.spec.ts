import { test, expect } from '@apackdev/testing';

// A surface offers its panel for surfaces without one (`fallbackPanel`) and says itself when it shows: the brain's
// inspect mode. The app shell asks only through that, never reading the brain's state.
test("inspect mode shows the brain's panel beside a surface that has none", async ({ app, appPage }) => {
  await app.navigate('default-setup/logs');
  const panel = appPage.locator('[data-onboarding-id="inspection-panel"]');
  await expect(panel).toHaveCount(0);

  await appPage.evaluate(() => (window as any).applicationState.surface('default-setup/brain').send({ type: 'TOGGLE_INSPECT' }));

  await expect(panel).toBeVisible();

  await appPage.evaluate(() => (window as any).applicationState.surface('default-setup/brain').send({ type: 'TOGGLE_INSPECT' }));
  await expect(panel).toHaveCount(0);
});
