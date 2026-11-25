import { expect, it, vi } from 'vitest';
import { ManifestSchema } from '@apackdev/pack-format';
import type { NativePackDeclaration, PackRegistration } from '@apackdev/sdk/framework';
import { startTestRuntime } from '@apackdev/sdk/testing';
import { createPackRegistry } from '../../src/packs/registry.ts';

startTestRuntime();

const declaration: NativePackDeclaration = {
  id: 'native-api', services: { shared: 'unavailable.ts#shared' },
  repositories: { sharedQueries: 'unavailable.ts#sharedQueries' },
  features: { worker: { description: 'Own a service and repository.',
    services: { worker: 'unavailable.ts#worker' }, repositories: { workerQueries: 'unavailable.ts#workerQueries' },
  } },
};

const registration = (): PackRegistration => ({ id: declaration.id,
  features: { worker: { services: ['worker'] } },
  services: { shared: {}, worker: {} }, repositories: { sharedQueries: {}, workerQueries: {} },
});

it('discovers native API ownership before binding and retains it after runtime unload', () => {
  const registry = createPackRegistry({ nativeDeclarations: [declaration] });
  expect(registry.getPackRegistration(declaration.id)).toBeNull();
  expect(registry.catalog.getSnapshot().native).toEqual([declaration]);
  const execute = vi.fn(() => { throw new Error('Discovery must not call API methods'); });
  registry.registerPack({ ...registration(), services: { shared: { execute }, worker: { execute } },
    repositories: { sharedQueries: { execute }, workerQueries: { execute } } });
  registry.unregisterPack(declaration.id);
  expect(registry.catalog.getSnapshot().native).toEqual([declaration]);
  expect(execute).not.toHaveBeenCalled();
});

it.each([
  ['missing service', (binding: PackRegistration) => { delete binding.services!.worker; }, 'services'],
  ['extra service', (binding: PackRegistration) => { binding.services!.extra = {}; }, 'services'],
  ['wrong feature owner', (binding: PackRegistration) => { binding.features!.worker.services = ['shared']; }, 'features.worker.services'],
  ['missing repository', (binding: PackRegistration) => { delete binding.repositories!.workerQueries; }, 'repositories'],
  ['extra repository', (binding: PackRegistration) => { binding.repositories!.extra = {}; }, 'repositories'],
])('refuses %s before publishing any runtime contribution', (_name, mutate, field) => {
  const registry = createPackRegistry({ nativeDeclarations: [declaration] });
  const binding = registration(); mutate(binding);
  expect(() => registry.registerPack(binding)).toThrow(`runtime ${field} does not match`);
  expect(registry.getPackRegistration(declaration.id)).toBeNull();
  expect(registry.catalog.getSnapshot().native).toEqual([declaration]);
});

it.each(['services', 'repositories'] as const)('rejects competing native %s owners during declaration admission', kind => {
  const registry = createPackRegistry({ nativeDeclarations: [declaration] });
  expect(() => registry.catalog.setNative([{ ...declaration, features: {
    ...declaration.features, other: { description: 'Competing API owner.', [kind]: declaration.features!.worker[kind] },
  } }])).toThrow(/features.worker.*features.other/);
  expect(registry.catalog.getSnapshot().native).toEqual([declaration]);
});

it('uses the same early ownership validation for authored pack APIs', () => {
  expect(() => ManifestSchema.parse({ id: 'owned-api', name: 'Owned', version: '1.0.0',
    extensions: { services: { shared: 'source.ts#shared' } }, features: {
      worker: { description: 'Conflicting owner.', services: { shared: 'source.ts#other' } },
    },
  })).toThrow(/extensions.services.*features.worker.services/);
});
