import type { Editor } from '@tiptap/core'
/** Native Agent editors use Claude's completions; app commands/references belong to the parent. */
export const nativePromptEditors = new WeakSet<Editor>()
