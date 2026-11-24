import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalPublishPluginRuntime } from '#features/code/be/services/claude-code/terminal-publish-plugin-runtime.ts'
import { ClaudeNativeNoticeSchema } from '#features/code/common/native-notice.ts'

function fixture(review = true) {
  const sessionId = randomUUID()
  const payload = {
    ...(review ? { card: { question: 'Publish release-notes to organization Example?', lines: ['Sends 2 files, 18 bytes'], values: ['README.md (12 bytes)'] } } : {}),
    everything: ['README.md (12 bytes)', 'secret.txt stays local'],
  }
  const item = { id: randomUUID(), payload }, open = [item]
  const dialog = { item, payload, sessionId, revision: randomUUID(), store: { getState: () => ({ open }) } }
  const control = {
    focus: 'cancel', confirmLabel: review ? 'Yes, publish' : 'Dismiss', cancelLabel: 'No',
    refuseInput: vi.fn(() => false), onConfirm: vi.fn(() => { open.pop() }), onCancel: vi.fn(() => { open.pop() }),
  }
  const root = { type: function RCe() {}, memoizedProps: { payload, wouldTakeAnswer: () => true }, child: { type: () => {}, memoizedProps: control } }
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) } }
  const fingerprint = createHash('sha256').update(root.type.toString()).digest('hex')
  const runtime = vm.runInNewContext(
    rewriteClaudeNativePlatformSelectors(claudeTerminalPublishPluginRuntime) + ';({project:nativePublishPlugin,answer:answerNativePublishPlugin})',
    {
      nativeDialog: () => open.length === 1 ? dialog : {}, process: { stdout: undefined }, Buffer,
      nativeFunctionName: (name: string) => name, nativeFunctionHash: () => fingerprint,
      composerFunctionHashes: new WeakMap(), createHash, setTimeout, dialogRevisions: new Map(),
    },
  )
  const request = (decision: 'publish_plugin_confirm' | 'publish_plugin_decline') => ({
    id: item.id, revision: dialog.revision, session_id: sessionId, decision,
  })
  return { n, runtime, open, payload, control, dialog, request, abort: new AbortController() }
}

it('preserves the native disclosure and delegates approval to the original mounted control', async () => {
  const f = fixture()
  const notice = ClaudeNativeNoticeSchema.parse(f.runtime.project(f.n).notice)
  expect(notice).toMatchObject({
    kind: 'permission_publish_plugin',
    files: f.payload.everything,
    paragraphs: f.payload.card?.lines,
    previewFiles: f.payload.card?.values,
  })
  const request = f.request('publish_plugin_confirm')
  await f.runtime.answer(f.n, request, f.abort)
  expect(f.control.onConfirm).toHaveBeenCalledOnce()
  await expect(f.runtime.answer(f.n, request, f.abort)).rejects.toThrow('expired')
})

it('offers only decline when the original review is unreadable', async () => {
  const f = fixture(false)
  expect(f.runtime.project(f.n).notice.choices).toEqual([{ value: 'publish_plugin_decline', label: 'No' }])
  await expect(f.runtime.answer(f.n, f.request('publish_plugin_confirm'), f.abort)).rejects.toThrow('unavailable')
  expect(f.control.onConfirm).not.toHaveBeenCalled()
  await f.runtime.answer(f.n, f.request('publish_plugin_decline'), f.abort)
  expect(f.control.onCancel).toHaveBeenCalledOnce()
})

it('refuses replacement decisions and keeps oversized disclosures in the native terminal', async () => {
  const f = fixture()
  const stale = f.request('publish_plugin_confirm')
  f.dialog.revision = randomUUID()
  await expect(f.runtime.answer(f.n, stale, f.abort)).rejects.toThrow('expired')
  f.payload.everything = Array(13).fill('x'.repeat(16000))
  expect(f.runtime.project(f.n)).toBeUndefined()
  expect(f.control.onConfirm).not.toHaveBeenCalled()
})
