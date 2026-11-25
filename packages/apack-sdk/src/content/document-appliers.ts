/**
 * The appliers of the `documents` and `commands` content keys: the SDK's document model, written through the
 * SDK's document and collection writers, so a pack ships documents without declaring a format or a writer.
 * One factory per key, as `createFlowApplier` is, so codegen and a test that applies fixtures build the same one.
 */
import { createFormatApplier } from './format-applier.ts';
import { SDK_ENTITIES } from '../types/sdk-entities.ts';
import type { ContentApplier } from '../utils/apply.ts';
import type { ContentEditPolicy } from '../framework/declaration-types.ts';

export interface DocumentApplierOptions {
  /** The entry's `onUserEdit`; see `ContentSourceSchema` */
  onUserEdit?: ContentEditPolicy;
}

const documentTreeApplier = (key: string, options: DocumentApplierOptions): ContentApplier => createFormatApplier({
  key,
  entities: [SDK_ENTITIES.Collection, SDK_ENTITIES.Document],
  identity: ['name'],
  media: true,
  ...options,
});

export function createDocumentsApplier(options: DocumentApplierOptions = {}): ContentApplier {
  return documentTreeApplier('documents', options);
}

export function createCommandsApplier(options: DocumentApplierOptions = {}): ContentApplier {
  return documentTreeApplier('commands', options);
}
