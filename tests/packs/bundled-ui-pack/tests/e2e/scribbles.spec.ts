// A pack that bundles its own @apackdev/ui (apack.json fe.bundleUi): its editor shares the host's
// ProseMirror and tiptap core. Run via `npm run test:external-pack` from the repo root.
import { test, expect } from '@apackdev/testing';
import { writeFile } from 'node:fs/promises';

test('renders and edits with its bundled @apackdev/ui editor', async ({ appPage, app }, testInfo) => {
  const errors: string[] = [];
  appPage.on('pageerror', (error) => errors.push(error.message));
  appPage.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await app.waitForSurface('scribbles');
  await app.navigate('scribbles');

  const editor = appPage.getByTestId('scribbles-editor').locator('.ProseMirror');
  await expect(editor).toContainText('Bundled editor', { timeout: 10_000 });
  try {
    await editor.fill('Bundled editor typed');
    await expect(appPage.getByTestId('scribbles-text')).toContainText('Bundled editor typed');
    // Two ProseMirror copies fail here ("Adding different instances of a keyed surface", instanceof checks)
    expect(errors).toEqual([]);
  } finally {
    const path = testInfo.outputPath('console-errors.json');
    await writeFile(path, JSON.stringify(errors));
    await testInfo.attach('bundled-editor-console-errors', { path, contentType: 'application/json' });
  }
});
