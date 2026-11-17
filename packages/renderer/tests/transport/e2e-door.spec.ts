import { afterEach, expect, it, vi } from 'vitest';
import { HOST } from '@apackdev/host/fe';
import type { Message } from '@apackdev/sdk/events';

const { send, claim } = vi.hoisted(() => ({
  send: vi.fn(async (_message: Message) => {}),
  claim: vi.fn(async (_input: { as: string }) => {}),
}));
vi.mock('@/transport', () => ({ trpc: { bus: { send: { mutate: send }, claim: { mutate: claim } } } }));
import { e2eSystems, receiveE2eAnswer } from '../../src/transport/e2e-door';

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });
const flush = async () => { for (let index = 0; index < 6; index++) await Promise.resolve(); };

it('settles each ask with the answer to its own call, whichever order the answers arrive in', async () => {
  const first = e2eSystems.ask('default-setup/code', { type: 'explorer.READ_FILE', path: '/a' });
  const second = e2eSystems.ask('default-setup/code', { type: 'explorer.READ_FILE', path: '/b' });
  await flush();
  expect(claim).toHaveBeenCalledWith({ as: HOST.e2e });
  const [asked, askedAgain] = send.mock.calls.map(([message]) => message);
  expect(asked).toMatchObject({ to: 'default-setup/code', sender: HOST.e2e, event: { path: '/a' } });
  expect(asked.call).toBeTruthy();
  expect(askedAgain.call).not.toBe(asked.call);

  expect(receiveE2eAnswer({ to: HOST.e2e, answering: askedAgain.call, event: { type: 'explorer.FILE_CONTENT', data: 'b' } })).toBe(true);
  expect(receiveE2eAnswer({ to: HOST.e2e, answering: asked.call, event: { type: 'explorer.FILE_CONTENT', data: 'a' } })).toBe(true);
  expect(await first).toEqual({ type: 'explorer.FILE_CONTENT', data: 'a' });
  expect(await second).toEqual({ type: 'explorer.FILE_CONTENT', data: 'b' });
});

it('leaves a message to anyone else to the shell, and takes an answer no ask waits for, saying so', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(receiveE2eAnswer({ to: 'default-setup/code', answering: 'call-1', event: { type: 'explorer.FILE_CONTENT' } })).toBe(false);
  expect(warn).not.toHaveBeenCalled();
  expect(receiveE2eAnswer({ to: HOST.e2e, answering: 'call-nobody-made', event: { type: 'explorer.FILE_CONTENT' } })).toBe(true);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('call-nobody-made'));
});

it("rejects a send the API refuses, and an ask whose send it refuses stops waiting", async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  send.mockRejectedValueOnce(new Error('no system "default-setup/nothing"'));
  await expect(e2eSystems.send('default-setup/nothing', { type: 'SEND_STATE' })).rejects.toThrow('no system');

  send.mockRejectedValueOnce(new Error('no system "default-setup/nothing"'));
  await expect(e2eSystems.ask('default-setup/nothing', { type: 'SEND_STATE' })).rejects.toThrow('no system');
  // Its call is no longer waited for, so an answer naming it is an orphan
  expect(receiveE2eAnswer({ to: HOST.e2e, answering: send.mock.calls.at(-1)![0].call, event: { type: 'LATE' } })).toBe(true);
  expect(warn).toHaveBeenCalledOnce();
});
