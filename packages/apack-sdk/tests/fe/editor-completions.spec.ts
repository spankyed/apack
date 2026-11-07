import { expect, it } from 'vitest'
import { reactive, readonly } from 'vue'
import { holdEditorCommandSuggestions, getEditorCommandSuggestionsEnabled } from '../../src/fe/editor-completions.ts'

it('retains another owner after duplicate or out-of-order cleanup', () => {
  const editor = {}, otherEditor = {}
  const releaseOld = holdEditorCommandSuggestions(editor)
  const releaseCurrent = holdEditorCommandSuggestions(editor)
  expect(getEditorCommandSuggestionsEnabled(otherEditor)).toBe(true)
  releaseOld(); releaseOld()
  expect(getEditorCommandSuggestionsEnabled(editor)).toBe(false)
  releaseCurrent()
  expect(getEditorCommandSuggestionsEnabled(editor)).toBe(true)
  const releaseReplacement = holdEditorCommandSuggestions(editor)
  releaseOld(); releaseCurrent()
  expect(getEditorCommandSuggestionsEnabled(editor)).toBe(false)
  releaseReplacement()
  expect(getEditorCommandSuggestionsEnabled(editor)).toBe(true)
})

it('shares ownership through Vue proxies without sharing it with another editor', () => {
  const editor = {}, otherEditor = {}
  const releaseProxy = holdEditorCommandSuggestions(reactive(editor))
  const releaseReadonly = holdEditorCommandSuggestions(readonly(editor))
  const releaseOther = holdEditorCommandSuggestions(otherEditor)
  releaseReadonly(); releaseOther()
  expect(getEditorCommandSuggestionsEnabled(editor)).toBe(false)
  expect(getEditorCommandSuggestionsEnabled(otherEditor)).toBe(true)
  releaseProxy()
  expect(getEditorCommandSuggestionsEnabled(reactive(editor))).toBe(true)
})
