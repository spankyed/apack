import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppModule } from '../../AppModule.ts';
import { getAppEnvironment } from '../../app-environment.ts';
import { createRendererCapture } from './capture.ts';
import { createRendererProfileTransport } from './profile-transport.ts';

/** Main owns the debugger; a lease prevents an old document's stop from closing a new capture. */
export function createPerformanceModule(): AppModule {
  const active = new Map<number, { id: string; capture: ReturnType<typeof createRendererCapture>; stop(): ReturnType<ReturnType<typeof createRendererCapture>['stop']> }>();
  function permitted(event: IpcMainInvokeEvent) {
    const env = getAppEnvironment().env;
    const window = BrowserWindow.fromWebContents(event.sender);
    if ((env !== 'development' && env !== 'test') || !window || window.webContents !== event.sender
      || event.senderFrame !== event.sender.mainFrame) throw Error('Renderer recording is unavailable');
    return event.sender;
  }
  return { enable({ app }) {
    ipcMain.handle('performance:renderer:start', async (event, input: unknown) => {
      const contents = permitted(event);
      const mode = z.enum(['lightweight', 'detailed']).parse(input);
      if (active.has(contents.id)) throw Error('A renderer capture is active or stopping');
      if (contents.debugger.isAttached()) throw Error('The renderer debugger is already owned');
      contents.debugger.attach('1.3');
      let attached = true;
      const detached = () => { attached = false; };
      contents.debugger.on('detach', detached);
      const post = (method: string, parameters?: object) => attached && contents.debugger.isAttached()
        ? contents.debugger.sendCommand(method, parameters) : Promise.reject(Error('Renderer debugger ownership was lost'));
      const profileTransport = mode === 'detailed' ? createRendererProfileTransport({ post, subscribe: listener => {
        const message = (_event: unknown, method: string, parameters: unknown) => listener(method, parameters);
        contents.debugger.on('message', message);
        return () => contents.debugger.removeListener('message', message);
      } }) : undefined;
      const capture = createRendererCapture({ pid: contents.getOSProcessId(),
        post,
        close: () => {
          contents.debugger.removeListener('detach', detached);
          if (attached && contents.debugger.isAttached()) contents.debugger.detach();
        },
      }, mode, profileTransport);
      const id = randomUUID();
      const closed = () => { void claim.stop().catch(() => {}); };
      const navigated = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (!inPlace && mainFrame) closed(); };
      const claim = { id, capture, stop: () => capture.stop().finally(() => {
        contents.removeListener('destroyed', closed);
        contents.removeListener('did-start-navigation', navigated);
        if (active.get(contents.id) === claim) active.delete(contents.id);
      }) };
      active.set(contents.id, claim);
      contents.once('destroyed', closed);
      contents.on('did-start-navigation', navigated);
      await capture.ready;
      return { id };
    });
    ipcMain.handle('performance:renderer:stop', (event, input: unknown) => {
      const contents = permitted(event);
      const id = z.string().uuid().parse(input);
      const claim = active.get(contents.id);
      if (!claim || claim.id !== id) throw Error('No matching renderer capture');
      return claim.stop();
    });
    app.on('before-quit', () => { for (const claim of active.values()) void claim.stop().catch(() => {}); });
  } };
}
