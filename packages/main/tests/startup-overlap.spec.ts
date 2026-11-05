import { expect, it, vi } from 'vitest';
import { createWindowManagerModule } from '../src/modules/window-manager/WindowManager.ts';
import type { ApiServer } from '../src/modules/api-server/ApiServer.ts';
import type { MainModuleScope } from '../src/MainModuleScope.ts';
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import { EventEmitter } from 'node:events';

vi.mock('electron-context-menu', () => ({ default: vi.fn() }));
vi.mock('../src/modules/api-server/logger.ts', () => ({ logRenderer: vi.fn(), logRendererFatal: vi.fn() }));
vi.mock('electron', async original => {
  const base = await original<typeof import('electron')>();
  return { ...base, ipcMain: { ...base.ipcMain, on: vi.fn(), removeListener: vi.fn() },
    dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) } };
});
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

function windowReadiness() {
  const f = fixture(async () => {});
  const window = Object.assign(new EventEmitter(), { webContents: {} });
  const controller = new AbortController();
  const manager = f.manager as unknown as {
    waitForRendererReady(window: BrowserWindow, signal: AbortSignal): Promise<void>;
  };
  const ready = manager.waitForRendererReady(window as unknown as BrowserWindow, controller.signal);
  return { window, controller, ready };
}
it('accepts readiness only from the window being loaded', async () => {
  const f = windowReadiness();
  const onReady = vi.mocked(ipcMain.on).mock.calls.filter(([channel]) => channel === 'renderer:ready').at(-1)![1];
  let settled = false;
  const result = f.ready.then(() => { settled = true; });
  onReady({ sender: {} }); await Promise.resolve();
  expect(settled).toBe(false);
  onReady({ sender: f.window.webContents }); await result;
  expect(ipcMain.removeListener).toHaveBeenLastCalledWith('renderer:ready', onReady);
  expect(f.window.listenerCount('closed')).toBe(0);
});
it.each(['closed', 'aborted'])('releases readiness ownership when loading is %s', async reason => {
  const f = windowReadiness();
  const failure = expect(f.ready).rejects.toThrow(reason === 'closed' ? 'closed' : 'cancelled');
  if (reason === 'closed') f.window.emit('closed'); else f.controller.abort();
  await failure;
  expect(f.window.listenerCount('closed')).toBe(0);
  expect(ipcMain.removeListener).toHaveBeenLastCalledWith('renderer:ready', expect.any(Function));
});
