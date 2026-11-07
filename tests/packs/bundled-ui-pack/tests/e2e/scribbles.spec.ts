// A pack that bundles its own @apackdev/ui (apack.json fe.bundleUi): its editor shares the host's
// ProseMirror and tiptap core. Run via `npm run test:external-pack` from the repo root.
import { test, expect } from '@apackdev/testing';

test('renders and edits with its bundled @apackdev/ui editor', async ({ appPage, app }) => {
  const errors: string[] = [];
  appPage.on('pageerror', (error) => errors.push(error.message));
  appPage.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  const externalRequests: string[] = [];
  await appPage.route(/^https?:/, route => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  await app.waitForSurface('scribbles');
  await app.navigate('scribbles');

  const editor = appPage.getByTestId('scribbles-editor').locator('.ProseMirror');
  await expect(editor).toContainText('Bundled editor', { timeout: 10_000 });
  await editor.fill('Bundled editor typed');
  await expect(appPage.getByTestId('scribbles-text')).toContainText('Bundled editor typed');
  expect(await appPage.evaluate(() => performance.getEntriesByType('resource')
    .some(entry => /\/monaco-vendor-[^/]+\.js/.test(entry.name)))).toBe(false);
  await appPage.getByTestId('scribbles-open-code').click();
  const code = appPage.getByTestId('scribbles-code');
  await expect(code.locator('.monaco-editor')).toBeVisible();
  await expect(code).toContainText('bundled');
  await code.locator('.view-line').first().click();
  await appPage.keyboard.press('ControlOrMeta+A');
  await appPage.keyboard.insertText('{"edited": true}');
  await expect(appPage.getByTestId('scribbles-code-value')).toContainText('{"edited": true}');
  expect(externalRequests).toEqual([]);
  // Two ProseMirror copies fail here ("Adding different instances of a keyed surface", instanceof checks)
  expect(errors).toEqual([]);
});
