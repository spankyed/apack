// The user's API keys: the only way a key's value reaches the backend. These procedures call the host store directly,
// never the event bus, so a value reaches no bus log, no `onIncoming` listener and no event; none returns a value.
import { z } from 'zod';
import { providerLabels } from '@apackdev/sdk/models';
import type { SecretsSnapshot } from '@apackdev/sdk/services';
import { secretsStore, secretsSnapshot } from '@apackdev/host/secrets';
import { procedure, router } from './trpc';

const provider = z.enum([...(Object.keys(providerLabels) as [string, ...string[]]), 'custom']) as z.ZodType<SecretsSnapshot['secrets'][number]['provider']>;
const id = z.string().min(1);
const label = z.string().min(1).max(100);
const value = z.string().min(1).max(10_000);

export const secretsRouter = router({
  list: procedure.query(() => secretsSnapshot()),
  add: procedure
    .input(z.object({ provider, label, value }))
    .mutation(({ input }) => {
      secretsStore.add(input.provider, input.label, input.value);
      return secretsSnapshot();
    }),
  replaceValue: procedure
    .input(z.object({ id, value }))
    .mutation(({ input }) => {
      secretsStore.replaceValue(input.id, input.value);
      return secretsSnapshot();
    }),
  select: procedure.input(z.object({ id })).mutation(({ input }) => {
    secretsStore.select(input.id);
    return secretsSnapshot();
  }),
  rename: procedure.input(z.object({ id, label })).mutation(({ input }) => {
    secretsStore.rename(input.id, input.label);
    return secretsSnapshot();
  }),
  delete: procedure.input(z.object({ id })).mutation(({ input }) => {
    secretsStore.delete(input.id);
    return secretsSnapshot();
  }),
  allowUnprotected: procedure.mutation(() => {
    secretsStore.allowUnprotected();
    return secretsSnapshot();
  }),
});
