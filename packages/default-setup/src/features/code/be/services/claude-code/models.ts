import { query } from './query.ts'
import type { QueryOptions } from './types.ts'
import type { ClaudeModelCatalog } from './host-controls.ts'

export interface ClaudeModelCatalogOptions extends Pick<QueryOptions, 'env' | 'cliPath' | 'signal' | 'includeUnsupportedModels'> {
  cwd: string
}

/** Starts/closes a native process and can run configured session lifecycle hooks. */
export async function getModels(options: ClaudeModelCatalogOptions): Promise<ClaudeModelCatalog> {
  const allowed = new Set(['cwd', 'env', 'cliPath', 'signal', 'includeUnsupportedModels'])
  const unsupported = Object.keys(options).filter(key => !allowed.has(key))
  if (unsupported.length) throw new Error(`unsupported model catalog options: ${unsupported.join(', ')}`)
  const handle = await query({ ...options, keepStdinOpen: true, noSessionPersistence: true })
  try { return await handle.getModels() } finally { await handle.close() }
}
