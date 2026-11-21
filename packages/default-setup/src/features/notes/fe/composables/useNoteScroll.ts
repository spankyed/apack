import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useState } from '@apackdev/sdk/fe'
import type { NotesState } from '../state.ts'

export function useNoteScroll(actor: NotesState, getNoteId: () => string | undefined) {
  const scrollContainerRef = ref<HTMLElement | null>(null)
  const { state: notes, send } = useState(actor)

  const save = (noteId: string) => {
    const el = scrollContainerRef.value
    if (!el) return
    send({ type: 'NOTE.SAVE_SCROLL', noteId, scrollTop: el.scrollTop })
  }

  const restore = (noteId: string) => {
    const target = notes.value.data.noteScrollPositions[noteId] ?? 0
    const attempt = (retries: number) => {
      const el = scrollContainerRef.value
      if (!el) return
      if (target > el.scrollHeight - el.clientHeight && retries > 0) {
        requestAnimationFrame(() => attempt(retries - 1))
        return
      }
      el.scrollTop = target
    }
    nextTick(() => requestAnimationFrame(() => attempt(30)))
  }

  watch(getNoteId, (newId, oldId) => {
    if (oldId) save(oldId)
    if (newId && newId !== oldId) restore(newId)
  }, { flush: 'pre', immediate: true })

  onBeforeUnmount(() => {
    const noteId = getNoteId()
    if (noteId) save(noteId)
  })

  return scrollContainerRef
}
