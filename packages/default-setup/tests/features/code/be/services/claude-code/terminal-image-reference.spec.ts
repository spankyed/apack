import { projectClaudeTerminalImageReferences } from '#features/code/be/services/claude-code/terminal-image-reference.ts'
import { createClaudeUiDrawing } from '#features/code/be/services/claude-code/ui-tree.ts'

const reference = { type: 'NativeImageReference', props: { imageId: 42, columns: 10, rows: 3, alt: 'Original image' }, part: { plugin: 'fixture' } }
it('addresses original named allocations only through their owning broker session', () => {
  const result = projectClaudeTerminalImageReferences(reference, { id: 'owned-session', target: 'remote-host' })
  expect(createClaudeUiDrawing(result).tree).toEqual({ kind: 'broker-image', imageId: 42, columns: 10, rows: 3, alt: 'Original image', plugin: 'fixture', terminalSession: { id: 'owned-session', target: 'remote-host' } })
  expect(reference.type).toBe('NativeImageReference')
  expect(JSON.stringify(result)).not.toMatch(/file|shm|pixels|base64/)
})
it('replaces a supplied address and refuses an already addressed native node', () => {
  const result = projectClaudeTerminalImageReferences({ ...reference, props: { ...reference.props, terminalSession: { id: 'wrong', target: null } } }, { id: 'current', target: null })
  expect(createClaudeUiDrawing(result).tree).toMatchObject({ terminalSession: { id: 'current', target: null } })
  expect(() => projectClaudeTerminalImageReferences({ ...reference, type: 'NativeBrokerImage' }, { id: 'current', target: null })).toThrow('terminal owner')
})
it.each([0, -1, 1.5, 0x100000000])('refuses invalid allocation identity %s', imageId => {
  const result = projectClaudeTerminalImageReferences({ ...reference, props: { ...reference.props, imageId } }, { id: 'current', target: null })
  expect(() => createClaudeUiDrawing(result)).toThrow('Invalid native broker Image')
})
it('retains nested drawing structure and bounds pathological nesting', () => {
  expect(projectClaudeTerminalImageReferences({ tree: { type: 'Box', children: [reference] } }, { id: 'current', target: null })).toMatchObject({ tree: { children: [{ type: 'NativeBrokerImage' }] } })
  const cycle: any = {}; cycle.self = cycle
  expect(() => projectClaudeTerminalImageReferences(cycle, { id: 'current', target: null })).toThrow('bound')
})
