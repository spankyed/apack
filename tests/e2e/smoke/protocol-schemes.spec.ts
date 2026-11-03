// What each custom scheme's privileges grant, in a real window: only Electron's registration and Chromium's checks can
// answer this, and a scheme losing its privileges fails in silence, images still loading while `fetch` is refused. Copying
// an image reads its `media://` URL with `fetch`; a video in a document or an editor tab has to seek.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { test, expect } from '@apackdev/testing';

const CLIP = path.join(import.meta.dirname, 'fixtures/clip.mp4');

/** What a video element at `src` reaches: where its `seekable` range ends, and where it lands sent 3 s in */
function seekIn(page: Page, src: string): Promise<{ seekableEnd: number; landed: number }> {
  return page.evaluate(async (url) => {
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error(`${url}: ${video.error?.message}`));
    });
    const seekableEnd = video.seekable.length ? video.seekable.end(0) : 0;
    video.currentTime = 3;
    await new Promise((resolve) => { video.onseeked = resolve; });
    return { seekableEnd, landed: video.currentTime };
  }, src);
}

test.describe('custom schemes', () => {
  /** A document's media folder holding the clip, as `media:upload` would have written it */
  async function mediaUrl(electronApp: ElectronApplication): Promise<string> {
    const userDataDir = await electronApp.evaluate(() => process.env.APACK_USER_DATA_DIR);
    expect(userDataDir, 'the app runs in its own data dir').toBeTruthy();
    const dir = path.join(resolveAppEnvironment({ env: 'test', userDataDir: userDataDir! }).appDir, 'media', 'schemes');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(CLIP, path.join(dir, 'clip.mp4'));
    return 'media://schemes/clip.mp4';
  }

  test('a window reads a media file with fetch', async ({ appPage, electronApp }) => {
    const url = await mediaUrl(electronApp);
    const read = await appPage.evaluate(async (src) => {
      const response = await fetch(src);
      return { ok: response.ok, size: (await response.blob()).size };
    }, url);
    expect(read).toEqual({ ok: true, size: fs.statSync(CLIP).size });
  });

  test('a video seeks over media://', async ({ appPage, electronApp }) => {
    const seek = await seekIn(appPage, await mediaUrl(electronApp));
    expect(seek.seekableEnd).toBeGreaterThan(3);
    expect(seek.landed).toBeCloseTo(3, 0);
  });

  test('a video seeks over local-file://', async ({ appPage }) => {
    const seek = await seekIn(appPage, `local-file://file?path=${encodeURIComponent(CLIP)}`);
    expect(seek.seekableEnd).toBeGreaterThan(3);
    expect(seek.landed).toBeCloseTo(3, 0);
  });
});
