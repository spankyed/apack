import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { createRendererProfileTransport } from '../src/modules/performance/profile-transport.ts';
function root() {
  const events = new EventEmitter();
  const post = vi.fn(async (method: string, parameters?: object): Promise<unknown> => {
    if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'owned-target' } };
    if (method === 'Target.attachToTarget') return { sessionId: 'owned-session' };
    if (method === 'Target.sendMessageToTarget') {
      const request = JSON.parse((parameters as { message: string }).message);
      let head: object = {};
      for (let depth = 0; depth < 128; depth++) head = { children: [head] };
      events.emit('message', 'Target.receivedMessageFromTarget', { sessionId: 'other-session', message: JSON.stringify({ id: request.id, error: {} }) });
      events.emit('message', 'Target.receivedMessageFromTarget', { sessionId: 'owned-session', message: JSON.stringify({ id: request.id, result: { profile: { head } } }) });
    }
    return {};
  });
  const transport = createRendererProfileTransport({ post, subscribe: listener => { events.on('message', listener); return () => events.off('message', listener); } });
  return { events, post, transport };
}
it('carries a 128-frame tree through shallow nested CDP messages and closes only its owned session', async () => {
  const { post, transport, events } = root();
  const answer = await transport.post('HeapProfiler.stopSampling') as { profile: { head: { children?: unknown[] } } };
  expect(answer.profile.head.children).toHaveLength(1);
  expect(post).toHaveBeenCalledWith('Target.attachToTarget', { targetId: 'owned-target', flatten: false });
  await transport.close(); await transport.close();
  expect(post.mock.calls.filter(([method]) => method === 'Target.detachFromTarget')).toHaveLength(1);
  expect(events.listenerCount('message')).toBe(0);
  await expect(transport.post('Profiler.start')).rejects.toThrow('unavailable');
});
it('rejects pending commands and removes its listener if closed during a missing reply', async () => {
  const { post, transport, events } = root();
  post.mockImplementation(async method => method === 'Target.getTargetInfo' ? { targetInfo: { targetId: 'owned-target' } } : method === 'Target.attachToTarget' ? { sessionId: 'owned-session' } : {});
  const result = transport.post('HeapProfiler.stopSampling').catch(error => error);
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith('Target.sendMessageToTarget', expect.any(Object)));
  await transport.close();
  expect(await result).toBeInstanceOf(Error);
  expect(events.listenerCount('message')).toBe(0);
});
it('does not leave a late-admitted nested session attached after its owner closes', async () => {
  const { post, transport, events } = root();
  let release!: (value: object) => void;
  post.mockImplementation(async method => method === 'Target.getTargetInfo' ? { targetInfo: { targetId: 'owned-target' } } : method === 'Target.attachToTarget' ? new Promise(resolve => { release = resolve; }) : {});
  const pending = transport.post('Profiler.start').catch(error => error);
  await vi.waitFor(() => expect(release).toBeDefined());
  await transport.close(); release({ sessionId: 'owned-session' });
  expect(await pending).toBeInstanceOf(Error);
  expect(post).toHaveBeenCalledWith('Target.detachFromTarget', { sessionId: 'owned-session' });
  expect(events.listenerCount('message')).toBe(0);
});
it('refuses malformed protocol replies without retaining exception payloads', async () => {
  const { post, transport, events } = root();
  const original = post.getMockImplementation()!;
  post.mockImplementation(async (method, parameters) => {
    if (method === 'Target.sendMessageToTarget') { events.emit('message', 'Target.receivedMessageFromTarget', { sessionId: 'owned-session', message: '{invalid' }); return {}; }
    return original(method, parameters);
  });
  await expect(transport.post('Profiler.stop')).rejects.toThrow('transport failed');
  await transport.close(); expect(events.listenerCount('message')).toBe(0);
});
