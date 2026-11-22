// How one content item's entity is removed — the one rule, for a caller that has only its entity type.
//
// It exists because the two writers each know their own half and the app has a third caller that knows
// neither: the user answering "delete it" on an item their pack stopped shipping (`DELETE_CONTENT_ITEM`,
// `@apackdev/host`'s packs system), which holds a content key and the entity type the applied content
// recorded. Destroying the entity there is wrong twice over — a flow's nodes and wiring are separate
// entities that would be orphaned, and an entity type whose pack registered a `remove` writer has a delete
// of its own, which for a soft-deleting type is what keeps the user's undo.
import { type EARS as EARSTypes } from '@elmdb/ears';
import { untypedWrite } from '../ears/index.ts';
import { EARS } from '../types/entities.ts';
import { flowRepository } from '../repositories/flow-repository.ts';
import { _contentWriterRegistry } from './writers.ts';

/**
 * Removes the entity an item wrote, the way whoever owns that entity type removes one.
 *
 * A flow is deleted through its repository, which takes its nodes and wiring with it; `allowRoot` because
 * the item being removed is the pack's and the root role is not a reason to keep an entity the content no
 * longer declares. Anything else goes through its pack's `remove` writer, and an entity type with no
 * writer is destroyed, which is what the generic applier does.
 */
export function removeContentEntity(entityType: string, id: EARSTypes.EntityId): void {
  if (entityType === EARS.Entity.Flow) {
    flowRepository.deleteFlow(id, { allowRoot: true });
    return;
  }
  const writer = _contentWriterRegistry.get(entityType);
  if (writer?.remove) writer.remove(id);
  else untypedWrite(id).destroy();
}
