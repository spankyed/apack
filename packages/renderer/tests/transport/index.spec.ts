import { describe, expect, it, vi } from 'vitest';
import { memoryPair } from '@apackdev/link';
import { muxTransport } from '@apackdev/host/transport/mux';
import type { _BackendPortTransport } from '@apackdev/sdk/fe';
import { createWindowTransport } from '../../src/transport/index.ts';

function createFakeBridge(initialStatus: {
  running: boolean;
  error?: { message: string; stack?: string };
  restartAttempts: number;
} = { running: false, restartAttempts: 0 }) {
  let connectCb: ((raw: _BackendPortTransport, info: { generation: number }) => void) | undefined;
  let statusCb: ((event: { type: string; error?: string; attempt?: number; maxAttempts?: number; reloaded?: boolean; restarting?: boolean; message?: string; source?: string }) => void) | undefined;
  const bridge = {
    backendPort: {
      connect(cb: (raw: _BackendPortTransport, info: { generation: number }) => void) {
        connectCb = cb;
        return () => {};
      },
    },
    apiStatus: {
      getStatus: vi.fn(async () => ({
        ...initialStatus,
        startupId: 'test',
        logPath: '',
        rendererLogPath: '',
        appEventsLogPath: '',
      })),
      onEvent(cb: (event: { type: string; error?: string; attempt?: number; maxAttempts?: number; reloaded?: boolean }) => void) {
        statusCb = cb as typeof statusCb;
        return () => {};
      },
    },
  };
  const deliverPort = (generation: number) => {
    const [clientRaw, serverRaw] = memoryPair();
    const serverMux = muxTransport(serverRaw);
    connectCb!(clientRaw as unknown as _BackendPortTransport, { generation });
    return { clientRaw, serverRaw, serverMux };
  };
  const emitStatus = (event: Parameters<NonNullable<typeof statusCb>>[0]) => {
    statusCb?.(event);
  };
  return { bridge, deliverPort, emitStatus };
}

describe('createWindowTransport lifecycle, cancellation, and permanent failure', () => {
  it('rejects pending waitForSession waiters on api:fatal and non-restarting api:stopped', async () => {
    const { bridge, emitStatus } = createFakeBridge();
    const transport = createWindowTransport(() => bridge);

    const pendingCall = transport.controlCall('packs.loaded');
    const pendingAsk = transport.linkAsk('host/application', 'ENTITY_EXISTS', { id: 'x' });
    const subEnds: unknown[] = [];
    transport.controlSubscribe('packs.catalog', undefined, {
      onData: () => {},
      onEnd: (err) => subEnds.push(err),
    });
    const followErrors: Error[] = [];
    transport.linkFollow('pack/f', 'v', {}, {
      onUpdate: () => {},
      onError: (err) => followErrors.push(err),
    });

    emitStatus({ type: 'api:fatal', source: 'backend', message: 'db corrupt' });

    await expect(pendingCall).rejects.toThrow('[backend] db corrupt');
    await expect(pendingAsk).rejects.toThrow('[backend] db corrupt');
    await vi.waitFor(() => expect(subEnds).toHaveLength(1));
    await vi.waitFor(() => expect(followErrors).toHaveLength(1));
    expect(followErrors[0]!.message).toContain('[backend] db corrupt');

    // Subsequent calls while still permanently failed reject immediately without hanging
    await expect(transport.controlCall('packs.loaded')).rejects.toThrow('[backend] db corrupt');
  });

  it('rejects pending waiters when initial apiStatus.getStatus() already reports permanent failure', async () => {
    const { bridge } = createFakeBridge({
      running: false,
      error: { message: 'Max restart attempts reached' },
      restartAttempts: 3,
    });
    const transport = createWindowTransport(() => bridge);

    await expect(transport.controlCall('packs.loaded')).rejects.toThrow('Max restart attempts reached');
  });

  it('cancels waitForSession waiters on early controlSubscribe unsubscribe() and linkFollow stop()', async () => {
    const { bridge, deliverPort } = createFakeBridge();
    const transport = createWindowTransport(() => bridge);

    const sub = transport.controlSubscribe('packs.catalog', undefined, {
      onData: vi.fn(),
      onEnd: vi.fn(),
    });
    const follow = transport.linkFollow('pack/f', 'v', {}, {
      onUpdate: vi.fn(),
      onError: vi.fn(),
    });

    // Unsubscribe / stop BEFORE the initial port arrives
    sub.unsubscribe();
    follow.stop();
    expect(sub.closed).toBe(true);

    const frames: unknown[] = [];
    const { serverMux, serverRaw } = deliverPort(1);
    serverMux.control.onFrame((frame) => {
      frames.push(frame);
      if (frame.type === 'req' && frame.method === 'packs.loaded') {
        serverMux.control.send({ type: 'res', id: frame.id, ok: true, value: [] });
      }
    });
    // Round-trip a fresh call on the new session to flush all queued microtasks/frames in order
    await expect(transport.controlCall('packs.loaded')).resolves.toEqual([]);

    // Only the probe req should have crossed — neither a leaked `sub` nor `follow` frame
    expect(frames.filter((f) => (f as { type?: string }).type === 'sub')).toEqual([]);
    serverRaw.close();
  });

  it('tryControlCall returns undefined when disconnected without queuing onto the next session', async () => {
    const { bridge, deliverPort } = createFakeBridge();
    const transport = createWindowTransport(() => bridge);

    // No open session yet: returns undefined immediately without waiting
    await expect(transport.tryControlCall('settings.close', { credential: 'old-cred' })).resolves.toBeUndefined();

    // Attaching a later session does NOT receive the skipped settings.close
    const frames: unknown[] = [];
    const { serverMux, serverRaw } = deliverPort(1);
    serverMux.control.onFrame((frame) => {
      frames.push(frame);
      if (frame.type === 'req') {
        serverMux.control.send({ type: 'res', id: frame.id, ok: true, value: frame.method === 'packs.loaded' ? [] : undefined });
      }
    });
    await expect(transport.controlCall('packs.loaded')).resolves.toEqual([]);
    expect(frames.filter((f) => (f as { method?: string }).method === 'settings.close')).toEqual([]);

    // While connected, tryControlCall sends on the open session
    await expect(transport.tryControlCall('settings.close', { credential: 'live-cred' })).resolves.toBeUndefined();
    expect(frames.some((f) => (f as { type?: string; method?: string }).method === 'settings.close')).toBe(true);

    serverRaw.close();
  });
});
