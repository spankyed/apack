// Action code runs in one sandbox (runActionCode) whether a flow's action step or services.action runs it:
// `params`, `services` with a logger and an emitter named after the action, `z`, and `flowId` from a flow step
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext, StepInput } from '@apackdev/sdk/steps';
import type { LogEvent } from '@apackdev/sdk/logger';
import type { ActionEntity } from '@apackdev/sdk';
import { servicesForAction } from '#generated/services.ts';
import type { PackServiceAccess } from '@apackdev/sdk/services';
import { registerPack, unregisterPack } from '@apackdev/testing/harness';
import { runActionCode } from '#extensions/steps/action/sandbox.ts';
import { repository } from '#generated/repository.ts';
import { testRootEvents } from '@apackdev/sdk/testing';
import { packId } from '#generated/ref.ts';
import { handler } from '#extensions/steps/action/runtime.ts';
import { actionService } from '#features/actions/be/services/action.ts';

// Logs what it can reach, and returns it
const ACTION = `
  const reached = {
    z: typeof z.string === 'function',
    flowId,
    repository: typeof services.repository.actionQueries.all,
    param: params.name,
  };
  services.logger.info('ran', reached);
  return reached;
`;

// What an action sends, and who it says sent it
const SENDING = `
  services.emitter.broadcast('default-setup/threads', { type: 'SET_PHASE', phase: 'Edit' });
  return 'sent';
`;

const logs: LogEvent[] = [];
let stopLogs: () => void;
beforeAll(() => { stopLogs = testRootEvents.onLog((event) => logs.push(event)); });
afterAll(() => stopLogs());
beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  logs.length = 0;
  vi.restoreAllMocks();
});

describe('the action sandbox', () => {
  it("runs a flow's inline action with z, the flow id and a logger named after the step", async () => {
    const sent: Array<{ type: string; result?: unknown }> = [];
    const input: StepInput = { runNodeId: 'RunNode-action', settings: {}, params: {} };
    const ctx = { flowRunNodeId: 'RunNode-flow', event: { type: 'go', name: 'from-event' }, runtime: { servicesForAction } } as unknown as ExecutionContext;

    await handler(input, { id: 'Node-1', label: 'Greet', nodeType: 'action', mode: 'code', actionFn: ACTION.replace('params.name', 'params.event.name') }, ctx, { send: (event: { type: string }) => sent.push(event) });

    const reached = { z: true, flowId: 'RunNode-flow', repository: 'function', param: 'from-event' };
    expect(sent).toEqual([{ type: 'COMPLETE', result: reached }]);
    expect(logs).toContainEqual({ level: 'info', message: 'ran', source: 'action:Greet', meta: reached });
  });

  it('runs a stored action through services.action with z and a logger named after the action', async () => {
    vi.spyOn(repository.actionQueries, 'all').mockReturnValue([{ label: 'Say Hi', actionFn: ACTION } as ActionEntity]);

    const result = await actionService.executeIfFound('Say Hi', { name: 'direct' });

    const reached = { z: true, flowId: undefined, repository: 'function', param: 'direct' };
    expect(result).toEqual(reached);
    expect(logs).toContainEqual(expect.objectContaining({ level: 'info', message: 'ran', source: 'action:Say Hi' }));
  });

  // The last sender that could not say who it was. An action's code is a string from the database, so only the run
  // itself knows both halves: the pack whose runtime ran it, and which action it was. Both go on every message it
  // sends, and `action:<label>` is the string its logger is named, so one grep finds the send and the log lines
  // around it.
  it('stamps the pack and the action on what the action sends', async () => {
    vi.spyOn(repository.actionQueries, 'all').mockReturnValue([{ label: 'Summarise Thread', actionFn: SENDING } as ActionEntity]);
    const sent: unknown[] = [];
    const stop = testRootEvents.onSurfaceSend((message) => sent.push(message));

    try {
      expect(await actionService.executeIfFound('Summarise Thread', {})).toBe('sent');
    } finally {
      stop();
    }

    expect(sent).toEqual([{
      to: 'default-setup/threads',
      call: expect.any(String),
      event: { type: 'SET_PHASE', phase: 'Edit' },
      from: packId,
      via: 'action:Summarise Thread',
    }]);
  });

  it('refuses escaped user-code logging and sends after the executing pack retires', async () => {
    let access!: PackServiceAccess;
    registerPack({ id: 'action-lifetime', bindServices(value) { access = value; return () => {}; } });
    try {
      const escaped = await runActionCode(`return {
        log: services.logger.info,
        send: () => services.emitter.broadcast('default-setup/threads', { type: 'SET_PHASE', phase: 'Edit' })
      };`, { label: 'Escaped', params: {}, servicesForAction: access.servicesForAction }) as { log(message: string): void; send(): void };
      escaped.log('accepted');
      expect(logs).toContainEqual(expect.objectContaining({ message: 'accepted', source: 'action:Escaped' }));
      unregisterPack('action-lifetime');
      expect(() => escaped.log('retired')).toThrow('revoked');
      expect(() => escaped.send()).toThrow('revoked');
      expect(() => access.servicesForAction('retired')).toThrow('revoked');
    } finally {
      try { unregisterPack('action-lifetime'); } catch { /* already retired */ }
    }
  });

  it('runs code that declares its own z and flowId', async () => {
    const shadowing = "const z = 1; const flowId = 'x'; return { z, flowId };";
    vi.spyOn(repository.actionQueries, 'all').mockReturnValue([{ label: 'Shadow', actionFn: shadowing } as ActionEntity]);

    expect(await actionService.executeIfFound('Shadow', {})).toEqual({ z: 1, flowId: 'x' });
  });
});
