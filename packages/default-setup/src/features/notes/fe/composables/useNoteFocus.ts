import { watch, nextTick, type Ref } from 'vue'
import { useState } from '@apackdev/sdk/fe'
import type { NotesState } from '../state.ts'
import type TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'

export function useNoteFocus(
  actor: NotesState,
  titleRef: Ref<HTMLInputElement | null>,
  editorRef: Ref<InstanceType<typeof TiptapEditor> | null>,
) {
  const { state: notes } = useState(actor)

  watch(() => notes.value.data.currentNote, (note, oldNote) => {
    if (!note || note.id === oldNote?.id) return
    // A note this window has just created opens with its title selected, to be named
    const isNewNote = note.id === notes.value.data.createdNoteId
    nextTick(() => {
      if (isNewNote) {
        titleRef.value?.focus()
        titleRef.value?.select()
      } else if (note.noteType !== 'tasklist') {
        editorRef.value?.editor?.commands.focus('start', { scrollIntoView: false })
      }
    })
  })

  watch(() => notes.value.data.selectedTask, (task, oldTask) => {
    if (!task || task.id === oldTask?.id) return
    const isNewTask = task.id === notes.value.data.createdNoteId
    if (isNewTask) {
      nextTick(() => {
        titleRef.value?.focus()
        titleRef.value?.select()
      })
    }
  })
}
