// Shared routing/admission limits. Training parameters remain owned by the training worker.
export const EXACT_VECTOR_CHUNK_LIMIT = 4096;
export const NATIVE_VECTOR_OWNER_TARGET = 256;

export function supportsNativeVectorTraining(dimensions: unknown): dimensions is number {
  return typeof dimensions === 'number' && Number.isSafeInteger(dimensions)
    && dimensions >= 128 && dimensions <= 4096 && dimensions % 8 === 0;
}
