// services.secrets: the user's API keys as metadata, and each pack's own secrets (values stay in the host store; see ../secrets)
import type { SecretsAdmin, SecretsService } from '@apackdev/sdk/services';
import { secretsStore } from '../secrets/index.ts';
import type { SecretsStore } from '../secrets/store.ts';

/** The service over a store: the user's keys for the host, and `forPack` for the service a pack is handed */
export function createSecretsService(store: SecretsStore): SecretsAdmin {
  const userSecrets = {
    status: () => store.status(),
    list: () => store.list(),
    select: (id: string) => store.select(id),
    rename: (id: string, label: string) => store.rename(id, label),
    delete: (id: string) => store.delete(id),
  };
  return {
    ...userSecrets,
    forPack: (packId): SecretsService => ({
      ...userSecrets,
      // The caller is the pack the host bound, never a name the pack passes
      own: {
        get: (name) => store.getOwned(packId, name),
        set: (name, value) => store.setOwned(packId, name, value),
        delete: (name) => store.deleteOwned(packId, name),
      },
    }),
  };
}

export const secrets: SecretsAdmin = createSecretsService(secretsStore);
