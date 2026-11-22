import vm from 'node:vm'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'
import { CLAUDE_UI_CONTROL_RESPONSE_MAX_BYTES, CLAUDE_UI_TEXT_MAX_LENGTH } from '#features/code/be/services/claude-code/ui-text-limits.ts'

function setup() {
  const itemId = 'e52c2ea0-92b8-4568-8242-831d03a04a26'
  const popEditableAt = vi.fn(() => ({ text: '[Image #4] Review the updated mockup.' }))
  const commands = [{ uuid: itemId, value: '[Image #4] Review the updated mockup.', images: [
    { id: 4, type: 'image', mediaType: 'image/png', content: 'cG5n' },
  ] }]
  const messageQueue = { popEditableAt, isFoldInFlight: () => false }
  const queue = { items: [{ id: itemId, editable: true }] }
  const snippet = (start: string, end: string) => {
    const first = claudeTerminalUiRuntime.indexOf(start)
    return claudeTerminalUiRuntime.slice(first, claudeTerminalUiRuntime.indexOf(end, first))
  }
  const edit = vm.runInNewContext(
    snippet('function nativeQueuedDraft(', 'function nativeMainPromptQueue(') +
    snippet('function editNativeQueuedPrompt(', 'function cancelNativeQueuedPrompt(') +
    ';editNativeQueuedPrompt',
    { Buffer, nativeUiTextMaxLength: CLAUDE_UI_TEXT_MAX_LENGTH, nativeUiControlResponseMaxBytes: CLAUDE_UI_CONTROL_RESPONSE_MAX_BYTES,
      dispatchNativeQueueAction: (_n: unknown, _request: unknown, _abort: unknown, apply: (value: unknown) => unknown) => apply({ commands, messageQueue, queue }) },
  )
  const runtime = { Tf: () => true, fdt: (item: typeof commands[number]) => item.value, Dwr: (item: typeof commands[number]) => item.images }
  const marker = '[Image #4]'
  const engine = {
    Hc: (text: string) => text.includes(marker) ? [{ id: 4, index: text.indexOf(marker), match: marker }] : [],
    nX: () => marker,
  }
  return { apply: () => edit({ runtime, engine }, { item_id: itemId }), commands, popEditableAt, itemId }
}

it('returns the associated image and leaves unowned marker-like text in the caption', () => {
  const f = setup()
  f.commands[0].value += ' Keep [Image #9] as text.'
  expect(f.apply()).toEqual({
    handled: true,
    restored: { id: f.itemId, text: 'Review the updated mockup. Keep [Image #9] as text.', images: [{ mediaType: 'image/png', data: 'cG5n' }] },
  })
  expect(f.popEditableAt).toHaveBeenCalledExactlyOnceWith(0, '', 0)
})

it.each(['oversize', 'unbound image', 'unsupported content'])('leaves a queued prompt in Claude when it has %s', (failure) => {
  const f = setup()
  const part = f.commands[0].images[0]
  if (failure === 'oversize') part.content = 'A'.repeat(CLAUDE_UI_CONTROL_RESPONSE_MAX_BYTES)
  if (failure === 'unbound image') part.id = 7
  if (failure === 'unsupported content') part.type = 'text'
  expect(f.apply()).toEqual({ handled: false })
  expect(f.popEditableAt).not.toHaveBeenCalled()
})
