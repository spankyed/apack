import type { PerformanceProfileTransport } from '@apackdev/host/diagnostics/node';

/**
 * Electron 37 parses debugger replies with Chromium's 200-level JSON reader. A valid V8 allocation
 * tree can exceed that depth. Non-flattened CDP sessions carry the reply as a string inside a shallow
 * event; JSON.parse then decodes it in JS. No network debugger is opened; the outer owner retains
 * target lifecycle.
 */
export function createRendererProfileTransport(port: {
  post(method: string, parameters?: object): Promise<unknown>;
  subscribe(listener: (method: string, parameters: unknown) => void): () => void;
}): PerformanceProfileTransport {
  let closed = false;
  let session: string | undefined;
  let admission: Promise<void> | undefined;
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  function refuse() { for (const request of pending.values()) request.reject(Error('Renderer profile transport failed')); pending.clear(); }
  const remove = port.subscribe((method, parameters) => {
    if (closed || method !== 'Target.receivedMessageFromTarget') return;
    const event = parameters as { sessionId?: unknown; message?: unknown } | null;
    if (!event || event.sessionId !== session) return;
    try {
      if (typeof event.message !== 'string' || Buffer.byteLength(event.message) > 16 * 1024 * 1024) throw Error('Invalid profile protocol reply');
      const response = JSON.parse(event.message) as { id?: unknown; result?: unknown; error?: unknown };
      if (!response || typeof response.id !== 'number') return;
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      if (response.error) request.reject(Error('Renderer profile protocol command failed'));
      else request.resolve(response.result ?? {});
    } catch { refuse(); }
  });
  async function ready() {
    admission ??= (async () => {
      const answer = await port.post('Target.getTargetInfo') as { targetInfo?: { targetId?: unknown } };
      if (closed || typeof answer.targetInfo?.targetId !== 'string') throw Error('Renderer target is unavailable');
      const attached = await port.post('Target.attachToTarget', { targetId: answer.targetInfo.targetId, flatten: false }) as { sessionId?: unknown };
      if (typeof attached.sessionId !== 'string') throw Error('Missing renderer profile session');
      session = attached.sessionId;
      if (closed) { await port.post('Target.detachFromTarget', { sessionId: session }); throw Error('Renderer profile transport closed'); }
    })();
    await admission;
  }
  return {
    async post(method, parameters) {
      await ready();
      if (closed || pending.size >= 8) throw Error('Renderer profile transport is unavailable');
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        void port.post('Target.sendMessageToTarget', { sessionId: session, message: JSON.stringify({ id, method, params: parameters ?? {} }) })
          .catch(() => { const request = pending.get(id); pending.delete(id); request?.reject(Error('Renderer profile command could not be sent')); });
      });
    },
    async close() {
      if (closed) return;
      closed = true; remove(); refuse();
      if (session) await port.post('Target.detachFromTarget', { sessionId: session });
    },
  };
}
