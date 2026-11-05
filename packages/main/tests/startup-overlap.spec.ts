import { expect, it, vi } from 'vitest';
import { createWindowManagerModule } from '../src/modules/window-manager/WindowManager.ts';
import type { ApiServer } from '../src/modules/api-server/ApiServer.ts';
import type { MainModuleScope } from '../src/MainModuleScope.ts';
import { dialog } from 'electron';

vi.mock('electron-context-menu', () => ({ default: vi.fn() }));
vi.mock('../src/modules/api-server/logger.ts', () => ({ logRenderer: vi.fn(), logRendererFatal: vi.fn() }));
vi.mock('electron', async original => ({ ...await original<object>(),
  dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
}));
function fixture(wait: () => Promise<void>) {
  const manager = createWindowManagerModule({
    initConfig: { preload: { path: '/preload.js' }, renderer: { path: '/renderer.html' } },
    apiServer: { waitForReady: wait } as unknown as ApiServer,
  });
  const loading = vi.spyOn(manager, 'restoreOrCreateWindow').mockResolvedValue(undefined);
  const app = { whenReady: async () => {}, on: vi.fn(), isPackaged: true, quit: vi.fn(), relaunch: vi.fn() };
  return { manager, loading, app, scope: { app } as unknown as MainModuleScope };
}
it('starts loading the renderer before backend readiness settles', async () => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const wait = vi.fn(() => ready);
  const f = fixture(wait);
  let finished = false;
  const enabling = f.manager.enable(f.scope).then(() => { finished = true; });
  await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
  expect(f.loading).toHaveBeenCalledWith(true);
  expect(finished).toBe(false);
  release(); await enabling;
  expect(f.app.quit).not.toHaveBeenCalled();
});
it('preserves the original API failure dialog while renderer loading is underway', async () => {
  const f = fixture(async () => { throw new Error('Database startup refused'); });
  await f.manager.enable(f.scope);
  expect(f.loading).toHaveBeenCalledWith(true);
  expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ detail: 'Database startup refused' }));
  expect(f.app.quit).toHaveBeenCalledOnce();
});
