import { newCall, type Message } from '@apackdev/sdk/events';
import { _settingsJsonProblems } from '@apackdev/sdk/framework';
import type { SettingsPort } from '@apackdev/sdk/fe';
import { settingsTargetPath, type SettingsSnapshot, type SettingsRecovery, type SettingsRecoveryRequest, type SettingsWriteCondition, type SettingsWriteResult } from '@apackdev/sdk/types';
import type { SettingsChange } from '../features/settings/be/types.ts';
import { getIn } from '../features/settings/document.ts';
import { authorizeSettings } from '../features/settings/authorization.ts';
import { HOST } from '../refs.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { createSettingsSnapshotReader, readSettingsRecovery } from './settings-snapshot.ts';

export interface WindowSettingsIO {
  send(message: Message): Promise<void>;
  /** Every request terminates even when a connected backend fails to answer. */
  timeoutMs?: number;
}

const refused = (message: string): SettingsWriteResult => ({ status: 'refused', problems: [message] });

/** The settings system's asks, whose answers this runtime takes */
const SETTINGS_ASKS: ReadonlySet<string> = new Set(['GET_SETTINGS', 'RECOVER_SETTINGS', 'UPDATE_SETTINGS', 'RESET_SETTINGS', 'RESET_ALL_SETTINGS', 'REPLACE_SETTINGS']);

/** One window owns this resource; the Settings view is an ordinary subscriber. */
export function createWindowSettingsRuntime(io: WindowSettingsIO) {
  const logger = createLogger('settings-window');
  const readSnapshot = createSettingsSnapshotReader();
  // `recovery` is this window's alone: packs never run then, and the port reports it as not yet loaded.
  let status: ReturnType<SettingsPort['status']> | 'recovery' = 'loading';
  let snapshot: SettingsSnapshot | undefined;
  let recovery: SettingsRecovery | undefined;
  let readCall: string | undefined;
  let readTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const pending = new Map<string, { resolve: (result: SettingsWriteResult) => void; timer: ReturnType<typeof setTimeout>; owner?: object; repair: boolean }>();
  const bindings = new Set<() => void>();
  const report = (error: unknown) => logger.error('Settings window failed', error instanceof Error ? error : new Error(String(error)));
  const tell = () => {
    for (const listener of listeners) {
      try { listener(); }
      catch (error) { report(error); }
    }
  };
  const timeout = io.timeoutMs ?? 30_000;

  function settle(call: string, result: SettingsWriteResult): void {
    const request = pending.get(call);
    if (!request) return;
    pending.delete(call);
    clearTimeout(request.timer);
    request.resolve(result);
  }

  function end(next: 'disconnected' | 'disposed', reason: string): void {
    if (status === 'disposed') return;
    clearTimeout(readTimer);
    readCall = undefined;
    snapshot = undefined;
    recovery = undefined;
    status = next;
    for (const dispose of bindings) dispose();
    for (const call of pending.keys()) settle(call, refused(reason));
    tell();
  }

  function send(event: SettingsChange | { type: 'GET_SETTINGS' }, call: string, transport = io.send): Promise<void> {
    // Routing labels are shared; the injected transport supplies the caller's authority separately.
    return transport({ to: HOST.settings, sender: HOST.settings, from: 'host', event, call });
  }

  function change(event: SettingsChange, transport = io.send, owner?: object): Promise<SettingsWriteResult> {
    if (status !== 'ready' && !(status === 'recovery' && event.type === 'RECOVER_SETTINGS' && !owner)) return Promise.resolve(refused('Settings are not ready. Wait for the backend to reconnect.'));
    let request: SettingsChange;
    try {
      if (_settingsJsonProblems(event).length) return Promise.resolve(refused('Settings changes must contain ordinary JSON data.'));
      request = structuredClone(event);
    }
    catch { return Promise.resolve(refused('Settings changes must contain serializable data.')); }
    const call = newCall();
    return new Promise(resolve => {
      const timer = setTimeout(() => settle(call, refused('The backend did not answer this settings change.')), timeout);
      pending.set(call, { resolve, timer, owner, repair: request.type === 'RECOVER_SETTINGS' });
      Promise.resolve().then(() => pending.has(call)
        ? send(request, call, transport) : undefined)
        .catch(error => settle(call, refused(String(error))));
    });
  }

  function acceptSnapshot(value: unknown): boolean {
    let next: SettingsSnapshot;
    try { next = readSnapshot(value, snapshot); }
    catch (error) {
      report(error);
      if (!snapshot) end('disconnected', 'The backend returned an invalid settings snapshot.');
      return false;
    }
    if (recovery) return false; // This host requires relaunch before normal settings consumption.
    if (!snapshot) {
      clearTimeout(readTimer);
      readCall = undefined;
    } else {
      if (next.runId !== snapshot.runId) return false;
      if (next.revision < snapshot.revision || next.catalog.revision < snapshot.catalog.revision) return true;
      if (next.revision === snapshot.revision && next.catalog.revision === snapshot.catalog.revision) return true;
    }
    snapshot = next;
    status = snapshot.status;
    tell();
    return true;
  }

  /**
   * Takes the settings' recovery: news that they need repair or were repaired, or the answer to a read or a repair.
   * Recovery lasts until relaunch, so an older revision is stale and cannot undo a repair.
   */
  function takeRecovery(value: unknown, answering: string | undefined): boolean {
    if (status === 'disposed' || status === 'disconnected') return true;
    if (!snapshot && !recovery && (!readCall || answering !== readCall)) return true;
    let next: SettingsRecovery;
    try { next = readSettingsRecovery(value); }
    catch (error) {
      report(error);
      if (!snapshot && !recovery) end('disconnected', 'The backend returned invalid settings recovery data.');
      return true;
    }
    // Recovery lasts until relaunch, so an older revision is stale and cannot undo a repair.
    if (!recovery || (next.version.runId === recovery.version.runId && next.version.revision >= recovery.version.revision)) {
      clearTimeout(readTimer);
      readCall = undefined;
      snapshot = undefined;
      recovery = next;
      status = 'recovery';
      for (const dispose of bindings) dispose();
    }
    for (const [call, request] of pending) {
      if (!request.repair) settle(call, refused('Settings require recovery.'));
      else if (call === answering) settle(call, next.problems.length ? refused('Some settings are still invalid.') : { status: 'saved' });
    }
    tell();
    return true;
  }

  function createPort(write: (event: SettingsChange) => Promise<SettingsWriteResult>, caller?: string): SettingsPort {
    return {
      get: <T,>(target: import('@apackdev/sdk/types').SettingsTarget) => {
        if (snapshot && caller !== undefined) authorizeSettings(snapshot.catalog, target, caller);
        return structuredClone(getIn(snapshot?.values, settingsTargetPath(target))) as T | undefined;
      },
      status: () => status === 'recovery' ? 'loading' : status,
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      update(target, path, value, condition) {
        if (!snapshot) return Promise.resolve(refused('Settings have not loaded.'));
        const previous = getIn(snapshot.values, [...settingsTargetPath(target), ...path]);
        const comparison: SettingsWriteCondition = condition ?? {
          runId: snapshot.runId,
          expected: previous === undefined ? { exists: false } : { exists: true, value: structuredClone(previous) },
        };
        return write({ type: 'UPDATE_SETTINGS', target, path: [...path], value, condition: comparison });
      },
      reset: target => write({ type: 'RESET_SETTINGS', target }),
    };
  }
  const port = createPort(change);

  return {
    port,
    /** Shares read state, while mutations and pending requests belong to one accepted pack. */
    bindPort(caller: string, transport: WindowSettingsIO['send']): { port: SettingsPort; dispose(): void } {
      if (status !== 'ready') throw new Error('Settings must be ready before accepting a pack frontend');
      const owner = {};
      let active = true;
      const subscriptions = new Map<() => void, () => void>();
      const bound = createPort(event => active ? change(event, transport, owner)
        : Promise.resolve(refused('This frontend settings binding was unloaded.')), caller);
      const dispose = () => {
        if (!active) return;
        active = false;
        bindings.delete(dispose);
        for (const [call, request] of pending) {
          if (request.owner === owner) settle(call, refused('This frontend settings binding was unloaded.'));
        }
        for (const [stop, listener] of subscriptions) {
          try { listener(); }
          catch (error) { report(error); }
          stop();
        }
      };
      bindings.add(dispose);
      return {
        port: {
          ...bound,
          get: <T,>(target: import('@apackdev/sdk/types').SettingsTarget) => active ? bound.get<T>(target) : undefined,
          status: () => active ? bound.status() : 'disposed',
          subscribe(listener) {
            if (!active) throw new Error('This frontend settings binding was unloaded.');
            const stop = port.subscribe(listener);
            const unsubscribe = () => { if (subscriptions.delete(unsubscribe)) stop(); };
            subscriptions.set(unsubscribe, listener);
            return unsubscribe;
          },
        },
        dispose,
      };
    },
    getSnapshot: (): SettingsSnapshot | undefined => snapshot && structuredClone(snapshot),
    /** The host retains recovery, including completed repair, across window reconnects until app relaunch. */
    getRecovery: (): SettingsRecovery | undefined => recovery && structuredClone(recovery),
    recover: (request: SettingsRecoveryRequest) => change({ type: 'RECOVER_SETTINGS', request }),
    connected(): void {
      if (status === 'disposed') return;
      end('disconnected', 'The connection changed before this settings change was answered.');
      status = 'loading';
      const call = newCall();
      readCall = call;
      readTimer = setTimeout(() => {
        if (readCall === call) end('disconnected', 'The backend did not provide settings.');
      }, timeout);
      tell();
      Promise.resolve().then(() => readCall === call ? send({ type: 'GET_SETTINGS' }, call) : undefined).catch(error => {
        if (readCall === call) end('disconnected', String(error));
      });
    },
    disconnected: () => end('disconnected', 'The backend disconnected before this settings change was answered.'),
    dispose(): void {
      end('disposed', 'The settings runtime was disposed.');
      listeners.clear();
    },
    /** Returns true only for messages owned here; secrets/help continue to the view. */
    receive(message: Message): boolean {
      if (message.to !== HOST.settings) return false;
      const event = message.event;
      if (event.type === 'SETTINGS_RECOVERY') return takeRecovery((event as { recovery?: unknown }).recovery, message.answering);
      if (event.type === 'ASK_ANSWERED' || event.type === 'ASK_FAILED') {
        const { asked } = event as { asked?: unknown };
        if (typeof asked !== 'string' || !SETTINGS_ASKS.has(asked)) return false;
        if (event.type === 'ASK_ANSWERED') {
          const answer = (event as { answer?: { snapshot?: unknown; recovery?: unknown } }).answer ?? {};
          if (asked === 'RECOVER_SETTINGS' || (asked === 'GET_SETTINGS' && 'recovery' in answer)) return takeRecovery(answer.recovery, message.answering);
          if (asked === 'GET_SETTINGS') {
            if (status === 'disposed' || status === 'disconnected') return true;
            if (!snapshot && !recovery && (!readCall || message.answering !== readCall)) return true;
            acceptSnapshot(answer.snapshot);
            return true;
          }
          if (message.answering && pending.has(message.answering)) {
            settle(message.answering, acceptSnapshot(answer.snapshot) ? { status: 'saved' } : refused('The backend returned an invalid settings save snapshot.'));
          }
          return true;
        }
        const failure = (event as { failure?: { message?: unknown; problems?: unknown } }).failure ?? {};
        const problems = failure.problems;
        const result: SettingsWriteResult = Array.isArray(problems) && problems.length > 0 && problems.every(problem => typeof problem === 'string')
          ? { status: 'refused', problems: [...problems] }
          : typeof failure.message === 'string' ? refused(failure.message) : refused('The backend returned an invalid settings refusal.');
        if (message.answering === readCall && readCall !== undefined) end('disconnected', 'The backend refused the settings read.');
        else if (message.answering && pending.has(message.answering)) settle(message.answering, result);
        return true;
      }
      if (!['SETTINGS_LOADED', 'SETTINGS_UPDATED', 'SETTINGS_RESET'].includes(event.type)) return false;
      if (status === 'disposed' || status === 'disconnected') return true;
      if (!snapshot && !recovery && (!readCall || message.answering !== readCall)) return true;
      acceptSnapshot(event.snapshot);
      return true;
    },
    replaceAll: (data: unknown, condition: SettingsWriteCondition) => change({ type: 'REPLACE_SETTINGS', data, condition }),
    resetAll: () => change({ type: 'RESET_ALL_SETTINGS' }),
  };
}
