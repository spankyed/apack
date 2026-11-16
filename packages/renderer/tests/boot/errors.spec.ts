// The app reports every uncaught renderer error as fatal, and Monaco's diff view throws one it recovers from.
// Suppressing that one depends on registration order (listeners on a target fire in the order they were added),
// which is why `installGlobalErrorHandling` registers the filter and the reporter together: the behaviour is
// checked here by dispatching both kinds of error, rather than by reading main.ts's source for the call order.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleVueError, installGlobalErrorHandling, reportRendererError } from '@/boot/errors';

const write = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  write.mockClear();
  (window as unknown as { electronAPI: unknown }).electronAPI = { rendererLog: { write }, startupId: 'test' };
});

/** Dispatches an uncaught error the way the browser does, and answers what was reported for it */
function uncaught(message: string): Array<Record<string, unknown>> {
  window.dispatchEvent(new ErrorEvent('error', { error: new Error(message), message, cancelable: true }));
  return write.mock.calls.map(([entry]) => entry);
}

describe('the renderer\'s global error handling', () => {
  it('the early HTML fallback waits for later filters while preserving unhandled startup failures', async () => {
    const html = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'index.html'), 'utf-8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    const target = new EventTarget();
    const document = window.document.implementation.createHTMLDocument();
    document.body.innerHTML = '<div id="app"></div><div id="error-page"><h1 id="error-title"></h1><p id="error-subtitle"></p><details><div id="error-detail"></div></details></div>';
    new Function('window', 'document', script!)(target, document);
    const filter = (event: Event) => event.preventDefault();
    target.addEventListener('unhandledrejection', filter);
    target.dispatchEvent(new Event('unhandledrejection', { cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.getElementById('app')?.style.display).not.toBe('none');
    target.removeEventListener('unhandledrejection', filter);
    const fatal = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(fatal, 'reason', { value: new Error('startup failed') });
    target.dispatchEvent(fatal);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.getElementById('app')?.style.display).toBe('none');
    expect(document.getElementById('error-detail')?.textContent).toContain('startup failed');
  });

  it('reports an uncaught error as fatal', () => {
    installGlobalErrorHandling();

    expect(uncaught('boom')).toEqual([expect.objectContaining({ source: 'window.error', message: 'boom', fatal: true })]);
  });

  it("doesn't report the diff-range error Monaco recovers from", () => {
    installGlobalErrorHandling();

    expect(uncaught('startLineNumber 5 cannot be after endLineNumberExclusive 3')).toEqual([]);
  });

  it('ignores vendor cancellation during editor disposal without hiding application cancellations', () => {
    installGlobalErrorHandling();
    const error = new Error('Canceled');
    error.name = 'Canceled';
    error.stack = 'Canceled: Canceled\n at dispose (file:///app/assets/monaco-vendor-abc123.js:1:1)';
    const event = new ErrorEvent('error', { error, message: error.message, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(write).not.toHaveBeenCalled();
    error.stack = 'Canceled: Canceled\n at dispose (file:///app/features/code.js:1:1)';
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message, cancelable: true }));
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ message: 'Canceled', fatal: true }));
    write.mockClear();
    error.stack = 'Canceled: Canceled\n at app (file:///app/features/code.js:1:1)\n at dispatch (file:///app/assets/monaco-vendor-abc123.js:1:1)';
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message, cancelable: true }));
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ message: 'Canceled', fatal: true }));
  });

  it('stops handled Monaco promise rejections before the fatal reporter', () => {
    installGlobalErrorHandling();
    const error = new Error('Canceled');
    error.name = 'Canceled';
    error.stack = 'Canceled: Canceled\n at dispose (file:///app/assets/monaco-vendor-abc123.js:1:1)';
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'reason', { value: error });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it('filters Vue-reported vendor disposal while keeping application cancellations fatal', () => {
    const show = vi.fn();
    window.__showErrorPage = show;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('Canceled');
    error.name = 'Canceled';
    error.stack = 'Canceled: Canceled\n at dispose (file:///app/assets/monaco-vendor-abc123.js:1:1)';
    handleVueError(error, 'beforeUnmount hook');
    expect(write).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    error.stack = 'Canceled: Canceled\n at dispose (file:///app/features/code.js:1:1)';
    handleVueError(error, 'beforeUnmount hook');
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ source: 'vue', message: 'Canceled', fatal: true }));
    expect(show).toHaveBeenCalledWith('Something went wrong', error.stack);
    log.mockRestore();
    delete window.__showErrorPage;
  });

  it('takes the filter from @apackdev/ui rather than repeating what it suppresses', () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'boot', 'errors.ts'), 'utf-8');

    expect(source).toContain("from '@apackdev/ui/components/monaco-error-filters'");
    expect(source).not.toContain('endLineNumberExclusive');
  });
});

it('reports an attributed contribution failure without classifying it as fatal', () => {
  reportRendererError('pack.component', new Error('Broken form'), { packId: 'fixture', area: 'settings form' }, false);
  expect(write).toHaveBeenCalledWith(expect.objectContaining({ source: 'pack.component', fatal: false,
    meta: expect.objectContaining({ detail: { packId: 'fixture', area: 'settings form' } }),
  }));
});
