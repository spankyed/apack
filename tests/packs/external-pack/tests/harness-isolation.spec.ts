// Service mocks last one test: the harness restores services after each, and inference fails until a test mocks it.
// A test app's waits and calls end when it stops, and its systems get events before a client connects, while their sends to surfaces wait for one.
import { describe, expect, it, vi } from 'vitest';
import { mockInference, mockService, startApp } from '@apackdev/testing/harness';
import { services } from '#generated/services.ts';
import { tell } from '#generated/events.ts';

const scripted = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('harness isolation between tests', () => {
  it('mocks a service and inference for this test', async () => {
    mockService('logger', scripted);
    mockInference('scripted');
    services.logger.info('scripted logger');
    expect(scripted.info).toHaveBeenCalledWith('scripted logger');
    expect((await services.inference.generateText({ model: 'openai:gpt-5', prompt: 'hi' })).text).toBe('scripted');
  });

  it('has the real logger, and inference that fails naming the fix, in the next test', async () => {
    const before = scripted.info.mock.calls.length;
    services.logger.info('real logger');
    expect(scripted.info.mock.calls.length).toBe(before);
    await expect(services.inference.generateText({ model: 'openai:gpt-5', prompt: 'hi' })).rejects.toThrow('mock inference with mockInference(reply)');
  });
});

describe('a stopped test app', () => {
  it('ends the waits it had with an error saying it stopped', async () => {
    const app = await startApp({ systems: ['memos'] });
    const waiting = app.nextEmit('memos', 'NEVER_SENT', { timeoutMs: 60_000 });

    app.stop();

    await expect(waiting).rejects.toThrow('The test app stopped');
    await expect(app.nextEmit('memos', 'NEVER_SENT')).rejects.toThrow('The test app stopped');
  });

  it("ends a wait nobody awaits when the harness stops the app, without an unhandled rejection", async () => {
    const app = await startApp({ systems: ['memos'] });
    // The run fails on an unhandled rejection: stopping after this test must not leave one
    void app.nextEmit('memos', 'NEVER_SENT', { timeoutMs: 60_000 });
  });

  it('fails every call made after it stopped, without an unhandled rejection for one nobody awaits', async () => {
    const app = await startApp({ systems: ['memos'] });
    app.stop();

    void app.nextEmit('memos', 'NEVER_SENT');
    await expect(app.connect()).rejects.toThrow('The test app stopped');
    await expect(app.send('memos', { type: 'ADD_MEMO', text: 'too late' })).rejects.toThrow('The test app stopped');
    await expect(app.settle()).rejects.toThrow('The test app stopped');
    await expect(app.runFlow('Memo Flow')).rejects.toThrow('The test app stopped');
    expect(() => app.system('memos')).toThrow('The test app stopped');
  });
});

describe('events sent before a client connects', () => {
  it('reach the systems, while what they send to surfaces is dropped until a client connects', async () => {
    const app = await startApp({ systems: ['memos'] });
    tell('memos', { type: 'ADD_MEMO', text: 'before any client' });
    await app.settle();

    expect(app.emitted('memos')).toEqual([]);
    await app.connect();
    expect(await app.nextEmit('memos', 'MEMOS_CONNECTED')).toMatchObject({ memos: [expect.objectContaining({ text: 'before any client' })] });
  });

  it('are routed by send without connecting', async () => {
    const app = await startApp({ systems: ['memos'] });
    await app.send('memos', { type: 'ADD_MEMO', text: 'sent unconnected' });
    await app.connect();

    expect(await app.nextEmit('memos', 'MEMOS_CONNECTED')).toMatchObject({ memos: [expect.objectContaining({ text: 'sent unconnected' })] });
  });
});

/**
 * `client` is the field `reply` routes on, and the harness is the one place it is written by hand rather than
 * stamped from a socket — so it is the one place an empty string can be passed. It is refused rather than
 * documented because the failure it causes is silent: `reply` reads the field as present and answers that
 * connection, while the app delivers only to the connection whose id matches and none is ever named `''`.
 */
describe('a client that names no connection', () => {
  it('is refused, rather than producing an answer addressed to nobody', async () => {
    const app = await startApp({ systems: ['memos'] });

    await expect(app.send('memos', { type: 'ADD_MEMO', text: 'x' }, { sender: 'memos', client: '' }))
      .rejects.toThrow('names none');

    app.stop();
  });
});
