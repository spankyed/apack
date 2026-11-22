import type {} from '@trpc/server/unstable-core-do-not-import';
import { type EARS } from '@elmdb/ears';
import { boundEars } from '@apackdev/sdk/ears';
import { z } from 'zod';
import { procedure, router } from './trpc';

export const entitiesRouter = router({
  exists: procedure.input(z.object({ id: z.custom<EARS.EntityId>(value =>
    typeof value === 'string' && value.includes('-'), 'Expected an entity ID') }))
    .query(({ input }) => boundEars().query.ids(input.id).exists()),
});
