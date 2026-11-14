import { nativeResourceFiles } from '../../../../src/extensions/blocks/display/native-resource-files.ts'
import type { ToolActivityEntry } from '#features/threads/be/types.ts'

const sessionId = '80d003be-ac57-44d8-82a8-6b2127b27fd6'
const path = `/owned profile/projects/release/${sessionId}/tool-results/mcp-resource-123-0-abc123.png`
/**
 * The row as a block's props carry it, and the details beside it.
 *
 * Two values because the props hold no `details` — a window fetches them for a block it has open — so a
 * reader that took them off the entry answered `undefined` for every row.
 */
function entry(contents: unknown): [Omit<ToolActivityEntry, 'details'>, ToolActivityEntry['details']] {
  return [
    { id: 'call', tool: 'ReadMcpResourceTool', summary: 'Read release evidence', status: 'ok', nativeResult: { uuid: 'result', sessionId } },
    { output: JSON.stringify({ contents }) },
  ]
}
it('exposes distinct original saved files without interpreting resource text as file access', () => {
  expect(nativeResourceFiles(...entry([{ uri: 'research://release/evidence', blobSavedTo: path }, { uri: 'research://release/evidence', blobSavedTo: path }, { uri: 'research://release/notes', text: path }]))).toEqual([{ path, uri: 'research://release/evidence', label: 'evidence' }])
})
it('requires a completed native resource result and its exact session namespace', () => {
  const [value, details] = entry([{ uri: 'research://release/evidence', blobSavedTo: path }])
  for (const update of [{ tool: 'Bash' }, { status: 'error' as const }, { nativeResult: undefined }, { nativeResult: { uuid: 'other', sessionId: '11111111-1111-1111-1111-111111111111' } }]) expect(nativeResourceFiles({ ...value, ...update }, details)).toEqual([])
})
it('refuses malformed output, unrelated paths and traversal or control characters', () => {
  for (const output of ['not JSON', '{}', '[]', JSON.stringify({ contents: null }), 'x'.repeat(65537)]) expect(nativeResourceFiles(entry([])[0], { output })).toEqual([])
  for (const blobSavedTo of ['/etc/passwd', path.replace('/tool-results/', '/other/'), path.replace('/projects/', '/../projects/'), path.replace('/projects/', '/./projects/'), path + '\u0000', path.replace('mcp-resource-', 'unrelated-'), 'file://' + path]) expect(nativeResourceFiles(...entry([{ uri: 'research://release/evidence', blobSavedTo }]))).toEqual([])
})
