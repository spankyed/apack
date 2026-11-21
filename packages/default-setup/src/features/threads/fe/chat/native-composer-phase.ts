import { surfaceStorage } from '@apackdev/sdk/fe'
import { ref as featureRef } from '#generated/ref.ts'
import { claudeWindowStorageKey } from './native-window-storage.ts'

export interface ClaudeComposerPhaseStage { phase: 'Plan' | 'Edit'; revision: string }
// Stage belongs to a window/thread, not to the shared native session. Keep it
// through pack/actor replacement even when browser storage is unavailable.
const key = Symbol.for('apack.default-setup.claude-composer-phases')
const scope = globalThis as unknown as Record<symbol, Map<string, ClaudeComposerPhaseStage> | undefined>
const stages = scope[key] ??= new Map<string, ClaudeComposerPhaseStage>()
export function readClaudeComposerPhase(threadId: string): ClaudeComposerPhaseStage | undefined {
  const key = claudeWindowStorageKey('composer-phase', threadId)
  if (!key) return
  const current = stages.get(key)
  if (current) return current
  try {
    const raw = surfaceStorage(featureRef('threads')).get(key)
    if (!raw) return
    const saved = JSON.parse(raw)
    if ((saved?.phase === 'Plan' || saved?.phase === 'Edit') && typeof saved.revision === 'string' && saved.revision) {
      stages.set(key, saved)
      return saved
    }
  } catch { /* A damaged or unavailable preference must not prevent composing. */ }
}
export function stageClaudeComposerPhase(threadId: string, phase: 'Plan' | 'Edit'): void {
  const key = claudeWindowStorageKey('composer-phase', threadId)
  if (!key) return
  const stage = { phase, revision: globalThis.crypto.randomUUID() }
  stages.set(key, stage)
  try { surfaceStorage(featureRef('threads')).set(key, JSON.stringify(stage)) } catch { /* Retain the window-local stage. */ }
}
export function commitClaudeComposerPhase(threadId: string, revision: string): void {
  const key = claudeWindowStorageKey('composer-phase', threadId)
  if (!key || readClaudeComposerPhase(threadId)?.revision !== revision) return
  stages.delete(key)
  try { surfaceStorage(featureRef('threads')).remove(key) } catch { /* Current window remains usable. */ }
}
