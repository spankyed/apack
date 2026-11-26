import { getCurrentScope, onScopeDispose, readonly, shallowRef } from 'vue';
// One settings resource per window, created before the shell and any pack frontend.
import { createWindowSettingsRuntime, type LoadedPackEntry, type FrontendSettingsBinding } from '@apackdev/host/fe';
import { newCall, type Message } from '@apackdev/sdk/events';
import { windowTransport } from '@/transport';

interface SettingsConnection {
  credential: Promise<string>;
  closed: AbortController;
}
let connection: SettingsConnection | undefined;

async function sendSettingsMessage(message: Message, credential: string): Promise<void> {
  if (message.event.type === 'GET_SETTINGS') {
    await windowTransport.linkSend(message);
    return;
  }
  await windowTransport.controlCall('settings.mutate', {
    credential,
    event: message.event,
    ...(message.sender ? { sender: message.sender } : {}),
    ...(message.call ? { call: message.call } : {}),
    ...(message.from ? { from: message.from } : {}),
  });
}

async function sendHostSettings(message: Message): Promise<void> {
  const accepted = connection;
  if (!accepted) throw new Error('The settings connection is unavailable.');
  if (message.event.type === 'GET_SETTINGS') {
    assertConnected(accepted);
    await windowTransport.linkSend(message);
    return;
  }
  const settingsCredential = await accepted.credential;
  assertConnected(accepted);
  await sendSettingsMessage(message, settingsCredential);
}

export const windowSettings = createWindowSettingsRuntime({
  send: sendHostSettings,
});
export const settingsPort = windowSettings.port;

export function resetApp(): Promise<void> {
  return sendHostSettings({ to: 'host/settings', sender: 'host/settings', call: newCall(), event: { type: 'RESET_APP' } });
}

function assertConnected(accepted: SettingsConnection): void {
  if (connection !== accepted || accepted.closed.signal.aborted) throw new Error('The settings connection changed.');
}

function releaseCredential(credential: string): void {
  void windowTransport.controlCall('settings.close', { credential }).catch(error => console.error('Could not release settings access', error));
}

function snapshotReady(accepted: SettingsConnection, allowRecovery = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = settingsPort.subscribe(check);
    const signal = accepted.closed.signal;
    signal.addEventListener('abort', check, { once: true });
    function check() {
      const status = settingsPort.status();
      const recovering = allowRecovery && windowSettings.getRecovery() !== undefined;
      if (!signal.aborted && connection === accepted && !recovering && (status === 'loading' || status === 'replacing')) return;
      stop();
      signal.removeEventListener('abort', check);
      if (!signal.aborted && connection === accepted && (status === 'ready' || recovering)) resolve();
      else reject(new Error('The settings connection is unavailable.'));
    }
    check();
  });
}

/** Trusted window bootstrap; pack loading starts only after authority and the validated snapshot arrive. */
export async function connectWindowSettings(): Promise<boolean> {
  disconnectWindowSettings();
  const accepted: SettingsConnection = {
    credential: windowTransport.controlCall('settings.openHost').then(({ credential }) => credential),
    closed: new AbortController(),
  };
  connection = accepted;
  windowSettings.connected();
  try {
    await Promise.all([accepted.credential, snapshotReady(accepted, true)]);
    assertConnected(accepted);
    return true;
  } catch (error) {
    if (connection !== accepted) return false;
    disconnectWindowSettings();
    throw error;
  }
}

export function disconnectWindowSettings(): void {
  const previous = connection;
  connection = undefined;
  previous?.closed.abort();
  if (previous) void previous.credential.then(releaseCredential, () => {});
  windowSettings.disconnected();
}

/** Declaration acceptance precedes this call; issuance verifies the backend's accepted build too. */
export async function settingsForPack(pack: LoadedPackEntry): Promise<FrontendSettingsBinding> {
  if (!pack.buildRevision) throw new Error(`Pack "${pack.id}" has no accepted build identity`);
  const accepted = connection;
  if (!accepted) throw new Error('The settings connection is unavailable.');
  await snapshotReady(accepted);
  const { credential } = await windowTransport.controlCall('settings.openPack', {
    id: pack.id,
    registrationId: pack.registrationId,
    declarationRevision: pack.declarationRevision,
    buildRevision: pack.buildRevision,
  });
  const close = () => releaseCredential(credential);
  try {
    assertConnected(accepted);
    const binding = windowSettings.bindPort(pack.id, async message => {
      assertConnected(accepted);
      await sendSettingsMessage(message, credential);
    });
    let active = true;
    return {
      port: binding.port,
      dispose() {
        if (!active) return;
        active = false;
        binding.dispose();
        close();
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}

/** Host forms follow the same window snapshot as pack consumers. */
export function useWindowSettingsSnapshot() {
  if (!getCurrentScope()) throw new Error('useWindowSettingsSnapshot runs in a component or effect scope');
  const snapshot = shallowRef(windowSettings.getSnapshot());
  const stop = settingsPort.subscribe(() => { snapshot.value = windowSettings.getSnapshot(); });
  onScopeDispose(stop);
  return readonly(snapshot);
}

/** Recovery is host-owned and remains visible until the repaired app is relaunched. */
export function useSettingsRecovery() {
  const recovery = shallowRef(windowSettings.getRecovery());
  const stop = settingsPort.subscribe(() => { recovery.value = windowSettings.getRecovery(); });
  onScopeDispose(stop);
  return readonly(recovery);
}
