// Embedding what vector indexes hold pending. The engine never calls a model: a write to a vector index's fields
// leaves the entity's chunks pending, and whoever wrote them runs `embedPending`, which embeds them with
// `services.inference` and stores the vectors.
import { boundEars } from '../ears/index.ts';
import { boundHost } from '../runtime/host-runtime.ts';
import type { EmbeddingModelId } from './models.ts';

/** What `embedPending` stored, and how many of the embeddings it made were stale by the time it stored them */
export interface EmbedPendingResult {
  stored: number;
  stale: number;
}

/**
 * Embeds every chunk waiting in the vector indexes of `types` (every type holding one unless given), `batch` chunks
 * (100 unless given) to a model call, until none waits. Each index's chunks are embedded with the model its manifest
 * entry names (`embed.model`), with the user's key for its provider. A chunk whose text changed while its batch was
 * being embedded is stale: its embedding isn't stored, and it is embedded again under its new text.
 */
export async function embedPending({ types, batch = 100 }: { types?: readonly string[]; batch?: number } = {}): Promise<EmbedPendingResult> {
  const ears = boundEars();
  const { inference } = boundHost().services;
  const result: EmbedPendingResult = { stored: 0, stale: 0 };
  for (const type of types ?? ears.embeddedTypes()) {
    for (;;) {
      const { model, chunks } = ears.pendingEmbeddings(type, { limit: batch });
      if (!chunks.length) break;
      const { embeddings } = await inference.embedMany({ model: model as EmbeddingModelId, values: chunks.map(({ text }) => text) });
      const { stored, stale } = ears.embed(chunks.map((chunk, at) => ({ ...chunk, model, vector: embeddings[at]! })));
      result.stored += stored;
      result.stale += stale;
    }
  }
  return result;
}

/**
 * `text` embedded with the model `type`'s vector index names, as `near` and `hybrid` take it: a search's vector,
 * comparable with the embeddings the index holds
 */
export async function embedSearchText(type: string, text: string): Promise<number[]> {
  const { model } = boundEars().pendingEmbeddings(type, { limit: 0 });
  const { embedding } = await boundHost().services.inference.embed({ model: model as EmbeddingModelId, value: text });
  return embedding;
}
