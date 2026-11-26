import { afterEach, expect, it, vi } from 'vitest';
import type { Message } from '@apackdev/sdk/events';

const { linkSend, linkAsk } = vi.hoisted(() => ({
  linkSend: vi.fn(async (_message: Message) => {}),
  linkAsk: vi.fn<
    (to: string, name: string, args: unknown) => Promise<{ ok: true; value: unknown } | { ok: false; failure: { kind: string; message: string } }>
  >(),
}));
vi.mock('@/transport', () => ({ windowTransport: { linkSend, linkAsk } }));
import { e2eSystems } from '../../src/transport/e2e-door';

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

it('translates native @apackdev/link ask outcomes into ASK_ANSWERED and ASK_FAILED events', async () => {
  linkAsk
    .mockResolvedValueOnce({ ok: true, value: { content: 'hello' } })
    .mockResolvedValueOnce({ ok: false, failure: { kind: 'unavailable', message: 'not ready' } });

  const answered = await e2eSystems.ask('default-setup/code', { type: 'explorer.READ_FILE', path: '/a' });
  expect(linkAsk).toHaveBeenNthCalledWith(1, 'default-setup/code', 'explorer.READ_FILE', { path: '/a' }, { diagnostics: undefined });
  expect(answered).toEqual({ type: 'ASK_ANSWERED', asked: 'explorer.READ_FILE', answer: { content: 'hello' } });

  const failed = await e2eSystems.ask('default-setup/code', { type: 'explorer.READ_FILE', path: '/b' });
  expect(failed).toEqual({
    type: 'ASK_FAILED',
    asked: 'explorer.READ_FILE',
    failure: { kind: 'unavailable', message: 'not ready' },
  });
});

it('rejects a send or ask when the transport rejects', async () => {
  linkSend.mockRejectedValueOnce(new Error('no system "default-setup/nothing"'));
  await expect(e2eSystems.send('default-setup/nothing', { type: 'SEND_STATE' })).rejects.toThrow('no system');

  linkAsk.mockRejectedValueOnce(new Error('transport closed'));
  await expect(e2eSystems.ask('default-setup/nothing', { type: 'SEND_STATE' })).rejects.toThrow('transport closed');
});
