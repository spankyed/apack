import type { SecretsClient } from '@apackdev/sdk/fe';
import { windowTransport } from '@/transport';

/** `secretsClient` in `@apackdev/sdk/fe`: off-bus Control Lane RPCs so secret values never enter `@apackdev/link`. */
export const secretsClient: SecretsClient = {
  list: () => windowTransport.controlCall('secrets.list'),
  add: (provider, label, value) => windowTransport.controlCall('secrets.add', { provider, label, value }),
  replaceValue: (id, value) => windowTransport.controlCall('secrets.replaceValue', { id, value }),
  select: (id) => windowTransport.controlCall('secrets.select', { id }),
  rename: (id, label) => windowTransport.controlCall('secrets.rename', { id, label }),
  delete: (id) => windowTransport.controlCall('secrets.delete', { id }),
  allowUnprotected: () => windowTransport.controlCall('secrets.allowUnprotected'),
};
