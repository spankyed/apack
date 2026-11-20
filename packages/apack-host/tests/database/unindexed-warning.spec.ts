// The engine's warning of a `where` that filtered a type's rows for want of an index, as the app's database store hands
// it on: the engine names the value index to declare, and the store adds where a pack declares one.
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseStore } from '../../src/database/open.ts';
import { removeTempDirs, tempDir } from './fixtures.ts';

afterEach(removeTempDirs);

describe("the database store's warn", () => {
  it('names the index to declare and the apack.json entry a pack declares it in', () => {
    const warnings: string[] = [];
    const { database, engine } = openDatabaseStore({
      path: path.join(tempDir('unindexed-warning-'), 'db'),
      schema: { getRegisteredEntityTypes: () => new Set(['Task']), getRegisteredRelationKinds: () => new Set(), getRegisteredRoles: () => new Set() },
      warn: (message) => warnings.push(message),
    });
    try {
      engine.transact(() => {
        for (let i = 0; i < 2_500; i++) engine.create('Task', { title: `Task ${i}` });
      });
      expect(engine.query('Task').where('title', 'Task 7').ids()).toHaveLength(1);
      expect(warnings).toEqual([expect.stringMatching(
        /^where\('title'\) filtered 2500 Task rows without an index \(.*unindexed-warning\.spec\.ts.*\)\. Declare a value index on Task\.title: "indexes": \["title"\] in its row rules, which a pack declares in the Task entry of its apack\.json$/,
      )]);
    } finally {
      database.close();
    }
  });
});
