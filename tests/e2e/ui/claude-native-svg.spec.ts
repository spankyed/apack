import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@apackdev/testing';

const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE;
const launcher = process.env.CLAUDE_RESEARCH_LAUNCHER;
const endpoint = process.env.CLAUDE_RESEARCH_MODEL_URL;
test.skip(!workspace || !launcher || !endpoint, 'Explicit private native research fixture required');

test('original desktop SVG preserves dimensions and interaction beside the real composer', async ({ app, appPage }, testInfo) => {
  expect(process.env.HOME).toBe(workspace);
  expect(new URL(endpoint!).hostname).toBe('127.0.0.1');
  const errors: string[] = [];
  appPage.on('pageerror', error => errors.push(error.message));
  await app.waitForPlugin('default-setup/threads');
  await app.navigate('default-setup/threads');
  await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread?.forcedMode)).toBe('Birth');
  await app.navigate('host/settings');
  await appPage.evaluate(() => {
    const settings = (window as any).applicationState.system.get('host/settings');
    settings.send({ type: 'TAB.SELECT', tab: 'general' });
    settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' });
  });
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..');
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!);
  // CLI paths save after the form's 600ms debounce; remount to verify persisted state.
  await appPage.waitForTimeout(700);
  await app.navigate('default-setup/threads');
  await app.navigate('host/settings');
  await expect(provider.getByPlaceholder('Path override (auto-detected if empty)')).toHaveValue(launcher!);
  await app.navigate('default-setup/threads');
  await appPage.evaluate(cwd => {
    const threads = (window as any).applicationState.system.get('default-setup/threads');
    threads.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd });
    threads.send({ type: 'VIEW_DASHBOARD' });
    threads.send({ type: 'SET_MODE', mode: 'Claude Code' });
  }, workspace!);
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]');
  const editor = card.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.fill('Help me review the changes in this workspace.');
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  const strip = card.getByTestId('composer-session-strip');
  const toolsToggle = strip.getByRole('button', { name: 'Session tools', exact: true });
  await expect(toolsToggle).toBeVisible({ timeout: 15000 }).catch(async error => {
    await writeFile(join(workspace!, 'native-svg-attach-failure.json'), JSON.stringify(await appPage.evaluate(() => {
      const context = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;
      return { nativeUiViews: context.nativeUiViews, thread: context.currentThread, text: document.body.innerText };
    }), null, 2));
    await appPage.screenshot({ path: testInfo.outputPath('native-svg-attachment-failure.png') });
    throw error;
  });
  await toolsToggle.click();
  const diagram = strip.locator('iframe[title="Deployment pipeline"]');
  const snapshot = () => appPage.evaluate(() => {
    const thread = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread;
    return { threadId: thread?.id, turns: thread?.context?.claudeCode?.turns, sessionId: thread?.context?.claudeCode?.sessionId };
  });
  const receipt = async () => JSON.parse(await readFile(join(workspace!, 'native-svg-actions.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return '{}'; throw error }));
  const geometry: unknown[] = [];
  try {
    await expect(diagram).toBeVisible();
    await expect.poll(async () => (await snapshot()).turns).toBe(1);
    const before = await snapshot();
    expect(before.sessionId).toBeTruthy();
    const draft = 'Review the deployment diagram before continuing.';
    await editor.fill(draft);
    const review = strip.getByRole('button', { name: 'Review deployment', exact: true });
    await expect(strip.getByAltText('Deployment thumbnail', { exact: true })).toBeVisible();
    await review.click();
    await expect.poll(async () => (await receipt()).count).toBe(1);
    await expect(appPage.getByText('Deployment checks reviewed', { exact: true })).toBeVisible();
    await review.focus();
    await appPage.keyboard.press('Enter');
    await expect.poll(async () => (await receipt()).count).toBe(2);
    expect((await receipt()).surface).toBe('desktop');
    expect((await receipt()).requestId).toBeTruthy();
    for (const width of [1100, 680]) {
      await appPage.setViewportSize({ width, height: width === 1100 ? 900 : 600 });
      for (const [label, expectedWidth, expectedHeight] of [
        ['Reset diagram', 180, 48], ['Expand diagram', 360, 96],
        ['Compact diagram', 120, 32], ['Precise diagram', 240.5, 64.25],
      ] as const) {
        await strip.getByRole('button', { name: label, exact: true }).click();
        await expect.poll(async () => {
          const box = await diagram.boundingBox({ timeout: 500 });
          return box ? Math.abs(box.width - expectedWidth) < 0.6 && Math.abs(box.height - expectedHeight) < 0.6 : false;
        }).toBe(true);
        const frame = appPage.frameLocator('iframe[title="Deployment pipeline"]');
        const inner = await frame.locator('svg').evaluate(node => {
          const box = node.getBoundingClientRect();
          return { width: box.width, height: box.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
        });
        // Chromium rounds a frame's viewport to whole CSS pixels; its outer box stays fractional.
        expect(inner.width).toBe(inner.viewportWidth);
        expect(inner.height).toBe(inner.viewportHeight);
        await expect.poll(async () => {
          // Native invalidation can replace srcdoc after layout settles; enter the current frame.
          await appPage.mouse.move(0, 0);
          await frame.locator('.stage').hover({ position: { x: 3, y: inner.height / 2 } });
          return frame.locator('.stage').evaluate(node => getComputedStyle(node).fill);
        }).toBe('rgb(22, 163, 74)');
        await expect(frame.locator('title')).toHaveText('Deployment checks passed');
        expect(await diagram.getAttribute('sandbox')).toBe('');
        geometry.push({ viewport: width, label, inner, box: await diagram.boundingBox({ timeout: 500 }) });
      }
      const frame = appPage.frameLocator('iframe[title="Deployment pipeline"]');
      const initialOpacity = await frame.locator('circle').evaluate(node => getComputedStyle(node).opacity);
      await expect.poll(() => frame.locator('circle').evaluate(node => getComputedStyle(node).opacity)).not.toBe(initialOpacity);
      await editor.focus();
      await expect(editor).toHaveText(draft);
      const send = card.getByRole('button', { name: 'Send', exact: true });
      for (const target of [editor, send]) {
        expect(await target.evaluate(node => {
          const r = node.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
          return x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && node.contains(document.elementFromPoint(x, y));
        })).toBe(true);
      }
      await appPage.screenshot({ path: testInfo.outputPath(`native-svg-${width}.png`) });
    }
    await toolsToggle.click();
    await expect(diagram).toBeHidden();
    await toolsToggle.click();
    await expect(diagram).toBeVisible();
    await expect(editor).toHaveText(draft);
    await card.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(async () => (await snapshot()).turns).toBe(2);
    const after = await snapshot();
    expect(after.threadId).toBe(before.threadId);
    expect(after.sessionId).toBe(before.sessionId);
    expect(errors).toEqual([]);
    await writeFile(join(workspace!, 'composer-app-evidence.json'), JSON.stringify({
      actualApp: true, nativeSvgDimensions: true, nativeSvgInteraction: true,
      nativeSvgNeighborAction: true, nativeRetainedDraft: true, sameSessionContinuation: true,
      before, after, geometry, receipt: await receipt(), errors,
    }, null, 2));
  } catch (error) {
    await appPage.screenshot({ path: testInfo.outputPath('native-svg-failure.png') });
    await writeFile(join(workspace!, 'native-svg-failure.json'), JSON.stringify({
      snapshot: await snapshot(), geometry, errors,
      diagram: await diagram.boundingBox({ timeout: 500 }).catch(() => null),
    }, null, 2));
    throw error;
  }
});
