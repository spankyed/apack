import { writeFile } from 'node:fs/promises';
import { test, expect } from '@apackdev/testing';

test('names the rendered conversation status without hiding the composer controls', async ({ app, appPage, electronApp }, info) => {
  await app.waitForSurface('default-setup/threads');
  await app.navigate('default-setup/threads');
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]');
  const indicator = appPage.getByTitle(/^Conversation status: /);
  for (const [width, height] of [[1100, 900], [680, 600]]) {
    await appPage.setViewportSize({ width, height });
    await expect(card).toBeVisible();
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveAttribute('role', 'status');
    const title = await indicator.getAttribute('title');
    expect(title).toMatch(/^Conversation status: \S/);
    await expect(indicator.locator('.sr-only')).toHaveText(title!);
    await expect(indicator).toHaveCSS('pointer-events', 'auto');
    await indicator.hover();
    const box = await indicator.boundingBox();
    expect(box).toBeTruthy();
    expect(await indicator.evaluate(element => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: 1 });
    const window = await electronApp.browserWindow(appPage);
    const png = await window.evaluate(async (window, size) => (await window.webContents.capturePage({ x: 0, y: 0, ...size })).toPNG().toString('base64'), { width, height });
    await writeFile(info.outputPath(`composer-status-label-${width}.png`), Buffer.from(png, 'base64'));
  }
});
