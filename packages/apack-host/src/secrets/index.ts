// The user's secrets, host-internal: the host and the API read and write them here. Packs reach only the metadata,
// through `services.secrets`, and never import this module.
import { resolveAppEnvironment, type AppEnv } from '@apackdev/sdk/env';
import { _rootEvents } from '@apackdev/sdk/runtime';
import { _getSecretsFilePath } from '@apackdev/sdk/utils';
import type { SecretsSnapshot } from '@apackdev/sdk/services';
import { createSecretsStore, type SecretsStore } from './store.ts';
import { dataKeyFile, fileKeyVault, osKeyVault } from './vault.ts';
import type { PackRegistry } from '../packs/registry.ts';

/**
 * Whether the data key goes in a file beside the secrets rather than in the OS credential store.
 *
 * Tests never touch the credential store. Beyond that it is the caller's choice, and the choice is what
 * makes an `apack pack dev` instance self-contained: the keychain is keyed by the app name, so every instance
 * of one channel would otherwise share a service, and clearing one instance's keys could take another's.
 *
 * **Gated on the variable, never on the environment alone.** A Beta a user launches normally carries no
 * environment from a shell, so it keeps reading the keychain its keys are already in — where switching it
 * on `env` would send every existing Beta user to an empty file vault and read as "the app lost my keys".
 *
 * @internal
 */
export function _useFileVault(env: AppEnv, requested: string | undefined): boolean {
  return env === 'test' || (env !== 'production' && requested === 'file');
}

export { createSecretsStore } from './store.ts';
export { dataKeyAccount, dataKeyFile, fileKeyVault, memoryKeyVault, osKeyVault, KeyVaultUnavailableError, type KeyVault } from './vault.ts';

let store: SecretsStore | undefined;

/** The app's store, created on first use (paths and the environment are resolved then) */
function appStore(): SecretsStore {
  if (store) return store;
  const context = resolveAppEnvironment();
  const filePath = _getSecretsFilePath();
  store = createSecretsStore({
    filePath,
    osVault: () => osKeyVault(context.appName),
    fileVault: () => fileKeyVault(dataKeyFile(filePath)),
    useFileVault: _useFileVault(context.env, process.env.APACK_SECRETS_VAULT),
  });
  return store;
}

/** The user's secrets (see `SecretsStore`) */
export const secretsStore: SecretsStore = {
  status: () => appStore().status(),
  list: () => appStore().list(),
  select: (id) => appStore().select(id),
  rename: (id, label) => appStore().rename(id, label),
  delete: (id) => appStore().delete(id),
  add: (provider, label, value) => appStore().add(provider, label, value),
  replaceValue: (id, value) => appStore().replaceValue(id, value),
  keyFor: (provider) => appStore().keyFor(provider),
  allowUnprotected: () => appStore().allowUnprotected(),
  clearAll: () => appStore().clearAll(),
  changedElsewhere: () => appStore().changedElsewhere(),
  onChange: (listener) => appStore().onChange(listener),
};

/** The stored keys' metadata and their protection, as the API's procedures return them (no values) */
export function secretsSnapshot(): SecretsSnapshot {
  return { secrets: secretsStore.list(), status: secretsStore.status() };
}

/**
 * Sends every system that declares it `SECRETS_CHANGED` (no values) on the root event bus whenever the stored keys or
 * their protection change, through the API's procedures, `services.secrets` or a failing credential store, so it
 * refreshes its surface and key checks. The app calls it once at boot. Before a settings system is registered there's
 * none to tell (in `registry`): once it runs, it sends the current keys on CLIENT_CONNECTED. Returns the unsubscribe.
 */
export function forwardSecretsChanges(registry: Pick<PackRegistry, 'getSurfaceEventValidationMap' | 'getEventValidationMap'>): () => void {
  return secretsStore.onChange(() => {
    // Every system that says it takes the event, not one designated feature: which keys the user has is the app's
    // news, and more than the settings view acts on it — starting the assistant's first flow once it can call a
    // model, for one. Never the values, which leave the store only through the API's own procedures.
    for (const [to, accepted] of registry.getEventValidationMap()) {
      if (accepted.has('*') || accepted.has('SECRETS_CHANGED')) {
        _rootEvents.emitIncoming({ to, event: { type: 'SECRETS_CHANGED' } });
      }
    }
  });
}
