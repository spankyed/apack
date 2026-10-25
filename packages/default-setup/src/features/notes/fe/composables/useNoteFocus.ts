import { watch, nextTick, type Ref } from 'vue'
import { useSelector } from '@xstate/vue'
import type { NotesState } from '../state.ts'
import type TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'

export function useNoteFocus(
  actor: NotesState,
  titleRef: Ref<HTMLInputElement | null>,
  editorRef: Ref<InstanceType<typeof TiptapEditor> | null>,
) {
  const currentNote = useSelector(actor, (s) => s.context.currentNote)
  const selectedTask = useSelector(actor, (s) => s.context.selectedTask)
  // A note this window has just created opens with its title selected, to be named
  const createdNoteId = useSelector(actor, (s) => s.context.createdNoteId)

  watch(currentNote, (note, oldNote) => {
    if (!note || note.id === oldNote?.id) return
    const isNewNote = note.id === createdNoteId.value
    nextTick(() => {
      if (isNewNote) {
        titleRef.value?.focus()
        titleRef.value?.select()
      } else if (note.noteType !== 'tasklist') {
        editorRef.value?.editor?.commands.focus('start', { scrollIntoView: false })
      }
    })
  })

  watch(selectedTask, (task, oldTask) => {
    if (!task || task.id === oldTask?.id) return
    const isNewTask = task.id === createdNoteId.value
    if (isNewTask) {
      nextTick(() => {
        titleRef.value?.focus()
        titleRef.value?.select()
      })
    }
  })
}
