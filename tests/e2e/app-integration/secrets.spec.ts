// Settings → Secrets end to end: API keys added and selected in the UI go to the host's encrypted store through the
// secrets procedures, and the key strings end up in no log, stored file or renderer state.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect } from '@apackdev/testing';

const RUN = Date.now().toString(36);
const WORK_KEY = `sk-proj-E2EWORK${RUN}abcdefghijklmnop`;
const PERSONAL_KEY = `sk-proj-E2EPERSONAL${RUN}abcdefghijklmnop`;

/** Every file under a directory */
function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}


test('adds, selects and stores API keys without the key strings reaching logs, files or renderer state', async ({ app, appPage, electronApp }) => {
  await app.navigate('host/settings');
  await appPage.evaluate(() => {
    // The app is shared by the worker's specs, so the tab may be another one left it on
    const settings = (window as any).applicationState.surface('host/settings');
    settings.send({ type: 'TAB.SELECT', tab: 'general' });
    settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' });
  });

  const openai = appPage.locator('[data-testid="secrets-provider-openai"]');
  await expect(openai).toBeVisible();
  // The test environment keeps the data key in a file: said plainly
  await expect(appPage.locator('[data-testid="secrets-protection"]')).toContainText('file on this system');

  // The first key: labelled after the provider by default
  await openai.locator('input[type="password"]').fill(WORK_KEY);
  await openai.locator('input').first().fill('Work');
  await openai.locator('button[title="Save"]').click();
  await expect(openai.locator('[data-testid="secret-Work"]')).toBeVisible();

  // A second account's key, then selected
  await openai.getByText('Add another key').click();
  await openai.locator('input[placeholder="Label, e.g. Work"]').fill('Personal');
  await openai.locator('input[type="password"]').fill(PERSONAL_KEY);
  await openai.locator('button[title="Save"]').click();
  await openai.locator('[data-testid="secret-Personal"] input[type="radio"]').check();

  const secrets = () => appPage.evaluate(() => (window as any).applicationState.surface('host/settings').getSnapshot().context.secrets as Array<{ label: string; provider: string; selected: boolean }>);
  await expect.poll(async () => (await secrets()).map((secret) => [secret.provider, secret.label, secret.selected])).toEqual([
    ['openai', 'Work', false],
    ['openai', 'Personal', true],
  ]);
  await expect(appPage.locator('[data-testid="secrets-error"]')).toHaveCount(0);

  // Nothing the renderer holds, and nothing on disk or in the logs, contains a key
  const rendererState = await appPage.evaluate(() => JSON.stringify((window as any).applicationState.surface('host/settings').getSnapshot().context));
  expect(rendererState).not.toContain('E2EWORK');
  expect(rendererState).not.toContain('E2EPERSONAL');

  const { userData, logs } = await electronApp.evaluate(({ app: electron }) => ({ userData: electron.getPath('userData'), logs: electron.getPath('logs') }));
  const files = [...filesUnder(userData), ...filesUnder(logs)];
  expect(files.some((file) => file.endsWith('secrets.json'))).toBe(true);
  const leaking = files.filter((file) => {
    const bytes = fs.readFileSync(file);
    return bytes.includes(Buffer.from('E2EWORK')) || bytes.includes(Buffer.from('E2EPERSONAL'));
  });
  expect(leaking).toEqual([]);
});
