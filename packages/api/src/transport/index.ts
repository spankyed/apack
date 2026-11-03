import { performanceRouter } from './performance.ts';
// Lets declaration emit name tRPC's router types through a public entry (TS2742 under bundler resolution)
import type {} from '@trpc/server/unstable-core-do-not-import';
import { systemBusRouter } from './bus';
import { packsRouter } from './packs';
import { secretsRouter } from './secrets';
import { settingsRouter } from './settings';
import { entitiesRouter } from './entities';
import { viewsRouter } from './views';
import { router } from './trpc';

export const appRouter = router({ performance: performanceRouter, entities: entitiesRouter, bus: systemBusRouter, packs: packsRouter, secrets: secretsRouter, settings: settingsRouter, views: viewsRouter });

export type AppRouter = typeof appRouter;
