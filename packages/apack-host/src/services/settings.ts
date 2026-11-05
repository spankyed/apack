import type { SettingsAdmin, SettingsService } from '@apackdev/sdk/services';
import type { SettingsStore } from '../features/settings/be/store.ts';

/** Pack services close over caller identity and expose no administrative methods. */
export function createSettingsService(store: SettingsStore): SettingsAdmin {
  const forPack = (packId: string): SettingsService => ({
    get: (target) => store.get(target, packId),
    set: (target, path, value, condition) => store.set(target, path, value, packId, condition),
    reset: (target) => store.reset(target, packId),
    onChange: store.onChange,
  });
  return {
    get: (target) => store.get(target),
    set: (target, path, value, condition) => store.set(target, path, value, undefined, condition),
    reset: (target) => store.reset(target),
    getAll: store.getAll,
    getSnapshot: store.getSnapshot,
    enterRecovery: store.enterRecovery,
    getRecovery: store.getRecovery,
    recover: store.recover,
    getOverrides: store.getOverrides,
    replaceAll: store.replaceAll,
    removeOverrides: store.removeOverrides,
    resetAll: store.resetAll,
    whileReplacingData: store.whileReplacingData,
    onChange: store.onChange,
    forPack,
  };
}
