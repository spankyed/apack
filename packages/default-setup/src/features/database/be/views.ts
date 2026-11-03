// The database feature's views. The schema is run again after a commit that moves a count or first writes a field, and no
// other: `catalog()` reads one key per name.
import { defineViews } from '@apackdev/sdk/framework';
import { generateSchemaInfo } from './repository/schema.ts';

export const databaseViews = defineViews({
  /** The names the data holds */
  schema: () => generateSchemaInfo(),
});
