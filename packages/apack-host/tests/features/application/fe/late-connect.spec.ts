// A backend that is slow to answer: after half a minute the shell tells the user it cannot connect, and goes on
// waiting. The clock says when to tell, and never that the backend will not come.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createActor, type Actor } from 'xstate';
import { createShellMachine, type ShellMachine } from '../../../../src/fe/index.ts';
import { fakeShell, surface } from './fakes.ts';

let shell = fakeShell({ surfaces: [surface('default-setup/notes')] });
let app: Actor<ShellMachine>;

beforeEach(() => {
  vi.useFakeTimers();
  shell = fakeShell({ surfaces: [surface('default-setup/notes')], hasWelcome: () => true });
  shell.client.describeConnection.mockResolvedValue('127.0.0.1 refused the connection');
  app = createActor(createShellMachine(shell.options), { systemId: 'host/application', input: { ownsLastActiveSurface: true } }).start();
  shell.client.connect();
});

afterEach(() => { app.stop(); vi.useRealTimers(); });

const backendAnswers = (hasOnboarded = true) =>
  shell.client.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', hasOnboarded, surfaceVisibility: {} } });

it('tells the user after half a minute without a connection, and not before', async () => {
  await vi.advanceTimersByTimeAsync(29_000);
  expect(shell.notify.errorPage).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1_000);

  expect(shell.notify.errorPage).toHaveBeenCalledWith('Unable to connect', '127.0.0.1 refused the connection');
});

it('takes the page down and carries on when the backend answers after that', async () => {
  await vi.advanceTimersByTimeAsync(30_000);
  expect(shell.notify.errorPage).toHaveBeenCalledTimes(1);

  backendAnswers();

  expect(app.getSnapshot().value).toEqual({ running: 'connected' });
  expect(shell.notify.clearErrorPage).toHaveBeenCalledWith('Unable to connect');
});

it('starts a user who has not onboarded there, however late the backend answers', async () => {
  await vi.advanceTimersByTimeAsync(30_000);

  backendAnswers(false);

  expect(app.getSnapshot().matches('onboarding')).toBe(true);
  expect(shell.notify.clearErrorPage).toHaveBeenCalledWith('Unable to connect');
});

it('puts no page up for a connection that arrived while it was reading why there was none', async () => {
  let describe: (details: string) => void = () => {};
  shell.client.describeConnection.mockReturnValue(new Promise<string>((resolve) => { describe = resolve; }));
  await vi.advanceTimersByTimeAsync(30_000);

  backendAnswers();
  describe('127.0.0.1 refused the connection');
  await vi.advanceTimersByTimeAsync(0);

  expect(shell.notify.errorPage).not.toHaveBeenCalled();
});

it('says nothing when the backend answers in time', async () => {
  backendAnswers();
  await vi.advanceTimersByTimeAsync(60_000);

  expect(shell.notify.errorPage).not.toHaveBeenCalled();
  expect(shell.notify.clearErrorPage).not.toHaveBeenCalled();
});
