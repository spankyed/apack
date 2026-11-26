// How loudly the app shows a system error. `fatal` replaces the window, `error` raises a toast, and
// `diagnostic` does neither: it is still logged and still recorded, so a pack test that leaves one
// fails, but it does not interrupt someone who can do nothing about it — a send to a surface no pack
// declares is for whoever wrote the send, and it is already in the Logs surface.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createShell, type ShellRuntime } from '../../../../src/fe/index.ts';
import { fakeShell, surface } from './fakes.ts';

let app: ShellRuntime;
let shell: ReturnType<typeof fakeShell>;
let toast: ReturnType<typeof fakeShell>['notify'];
// The error page, which replaces the window
let showErrorPage: ReturnType<typeof fakeShell>['notify']['errorPage'];

beforeEach(() => {
  shell = fakeShell({ surfaces: [surface('notes')] });
  toast = shell.notify;
  showErrorPage = shell.notify.errorPage;
  app = createShell(shell.options, { ownsLastActiveSurface: false }).start();
});
afterEach(() => app.stop());

const systemError = (severity: 'diagnostic' | 'error' | 'fatal') =>
  app.send({ type: 'SYSTEM_ERROR', message: `a ${severity}`, severity });

describe('SYSTEM_ERROR', () => {
  it('raises a toast for an ordinary error', () => {
    systemError('error');
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(showErrorPage).not.toHaveBeenCalled();
  });

  it('replaces the window for a fatal one, its message and stack apart', () => {
    app.send({ type: 'SYSTEM_ERROR', message: 'a fatal', stack: 'Error: a fatal\n    at boot', severity: 'fatal' });
    expect(showErrorPage).toHaveBeenCalledWith('Something went wrong', { message: 'a fatal', stack: 'Error: a fatal\n    at boot' });
    expect(toast.error).not.toHaveBeenCalled();
  });

  // The whole point of the severity: the bus reports a dropped send with it
  it('shows the user nothing for a diagnostic', () => {
    systemError('diagnostic');
    expect(toast.error).not.toHaveBeenCalled();
    expect(showErrorPage).not.toHaveBeenCalled();
  });
});

// The error page lays out an error as its message over the stack it can expand: a failure keeps both on its way there
describe('BACKEND_ERROR', () => {
  it('shows the error page with the failure as the backend reported it, message and stack apart', () => {
    const failure = { message: 'Max restart attempts reached', stack: 'Error: Max restart attempts reached\n    at ApiServer' };
    shell.client.fail(failure);

    expect(showErrorPage).toHaveBeenCalledWith('Something went wrong', failure);
    expect(app.getSnapshot().matches('error')).toBe(true);
  });
});
