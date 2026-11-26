import { ref as featureRef } from '#generated/ref.ts'
import type { ClaudeAgentDraftSnapshot } from './native-agent-draft.ts'

const store = 'drafts'
let database: Promise<IDBDatabase> | undefined

function openDrafts(): Promise<IDBDatabase> {
  if (database) return database
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`${featureRef('threads')}:claude-parent-drafts`, 1)
    request.onupgradeneeded = () => { request.result.createObjectStore(store) }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const opened = request.result
      opened.onversionchange = () => {
        opened.close()
        if (database === opening) database = undefined
      }
      opened.onclose = () => { if (database === opening) database = undefined }
      resolve(opened)
    }
  })
  database = opening
  void opening.catch(() => { if (database === opening) database = undefined })
  return opening
}

/** Undefined means the legacy window cache may be consulted. Null is a committed empty draft. */
export async function readDurableClaudeWindowDraft(key: string): Promise<ClaudeAgentDraftSnapshot | null | undefined> {
  const opened = await openDrafts()
  return new Promise((resolve, reject) => {
    const transaction = opened.transaction(store)
    const request = transaction.objectStore(store).get(key)
    transaction.oncomplete = () => resolve(request.result)
    transaction.onabort = () => reject(transaction.error)
  })
}

async function writeDraft(key: string, draft: ClaudeAgentDraftSnapshot | null) {
  const opened = await openDrafts()
  await new Promise<void>((resolve, reject) => {
    const transaction = opened.transaction(store, 'readwrite', { durability: 'strict' })
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.objectStore(store).put(draft, key)
  })
}

const writes = new Map<string, { draft: ClaudeAgentDraftSnapshot | null | undefined }>()

/** A slow write holds at most one pending snapshot for the same window and conversation. */
export function saveDurableClaudeWindowDraft(key: string, draft: ClaudeAgentDraftSnapshot | null) {
  const queued = writes.get(key)
  if (queued) {
    queued.draft = draft
    return
  }
  const pending = { draft: draft as ClaudeAgentDraftSnapshot | null | undefined }
  writes.set(key, pending)
  void (async () => {
    try {
      while (pending.draft !== undefined) {
        const next = pending.draft
        pending.draft = undefined
        try { await writeDraft(key, next) } catch { /* The renderer cache remains available. */ }
      }
    } finally { writes.delete(key) }
  })()
}
