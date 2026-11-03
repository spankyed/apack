// What a note's text derives: its `linkTargets` and its REFERENCES relations, whoever wrote the text
import { defineProjections } from '@apackdev/sdk/framework';
import { query, EARS } from '#generated/ears.ts';
import { resolveReferencesTo, syncReferences } from './repository/link-utils.ts';

const sync = (id: EARS.EntityId) => {
  const note = query.withTrashed.ids(id).pickOne(['content']);
  if (note) syncReferences(id, (note.content as string | undefined) ?? '');
};

export const noteProjections = defineProjections({
  references: {
    from: [EARS.Entity.Note],
    apply(ids) {
      for (const id of ids as EARS.EntityId[]) {
        sync(id);
        // The links other notes' text already makes to one that has just arrived
        resolveReferencesTo(id);
      }
    },
  },
});
