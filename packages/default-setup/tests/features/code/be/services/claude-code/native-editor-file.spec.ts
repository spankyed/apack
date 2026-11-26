import {afterEach, describe, expect, it} from 'vitest'
import {chmodSync, linkSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openClaudeNativeEditorFile} from '#features/code/be/services/claude-code/native-editor-file.ts'

const cleanup: (() => void)[] = []
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose() })
function fixture(content = 'Original environment\n') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'apack-editor-file-')))
  cleanup.push(() => rmSync(directory, {recursive: true, force: true}))
  const path = join(directory, 'auto-mode-env-edit-0123456789abcdef.md')
  writeFileSync(path, content, {mode: 0o600})
  return {directory, path, open(maxBytes = 8_000_000) {
    const editor = openClaudeNativeEditorFile(path, {directory, maxBytes})
    cleanup.push(editor.close)
    return editor
  }}
}

describe('original native editor file handoff', () => {
  it('offers original text and saves unicode through the same file, truncating old bytes', () => {
    const f = fixture(), editor = f.open()
    expect(editor.content).toBe('Original environment\n'); expect(editor.fileIdentity).toMatch(/^[a-f0-9]{64}$/)
    editor.finish({kind: 'save', content: '新\n'})
    expect(readFileSync(f.path, 'utf8')).toBe('新\n')
    expect(() => editor.finish({kind: 'save', content: 'late'})).toThrow(/closed/)
  })
  it('preserves a leading BOM in original text', () => {
    const f = fixture('\uFEFFOriginal'), editor = f.open()
    expect(editor.content).toBe('\uFEFFOriginal'); editor.finish({kind: 'save', content: editor.content})
    expect(readFileSync(f.path, 'utf8')).toBe('\uFEFFOriginal')
  })
  it('cancel and child disposal leave original bytes untouched', () => {
    const f = fixture(), editor = f.open(); editor.finish({kind: 'cancel'}); editor.close()
    expect(readFileSync(f.path, 'utf8')).toBe(editor.content)
    const next = f.open(); next.close(); expect(readFileSync(f.path, 'utf8')).toBe(editor.content)
  })
  it('refuses a replaced file and does not write to either inode', () => {
    const f = fixture(), editor = f.open(), moved = f.path + '.old'
    renameSync(f.path, moved); writeFileSync(f.path, 'Replacement', {mode: 0o600})
    expect(() => editor.finish({kind: 'save', content: 'stale'})).toThrow(/identity/)
    expect(readFileSync(f.path, 'utf8')).toBe('Replacement'); expect(readFileSync(moved, 'utf8')).toBe(editor.content)
  })
  it('refuses concurrent text changes before writing', () => {
    const f = fixture(), editor = f.open(); writeFileSync(f.path, 'Changed elsewhere')
    expect(() => editor.finish({kind: 'save', content: 'stale'})).toThrow(/text changed/)
    expect(readFileSync(f.path, 'utf8')).toBe('Changed elsewhere')
  })
  it('refuses symlinks, hard links and permissive files', () => {
    const f = fixture(), target = f.path + '.target'; renameSync(f.path, target); symlinkSync(target, f.path)
    expect(() => f.open()).toThrow(); rmSync(f.path); linkSync(target, f.path)
    expect(() => f.open()).toThrow(/identity/); rmSync(target); chmodSync(f.path, 0o644)
    expect(() => f.open()).toThrow(/identity/)
  })
  it('rechecks permissions and links before a save', () => {
    const f = fixture(), editor = f.open(); linkSync(f.path, f.path + '.link')
    expect(() => editor.finish({kind: 'save', content: 'no'})).toThrow(/identity/)
    expect(readFileSync(f.path, 'utf8')).toBe(editor.content)
  })
  it('refuses another directory and non-native filenames', () => {
    const f = fixture(), other = fixture()
    expect(() => openClaudeNativeEditorFile(f.path, {directory: other.directory, maxBytes: 100})).toThrow(/path/)
    const path = join(f.directory, 'settings.json'); writeFileSync(path, '{}', {mode: 0o600})
    expect(() => openClaudeNativeEditorFile(path, {directory: f.directory, maxBytes: 100})).toThrow(/path/)
  })
  it('enforces byte limits without truncation, allowing documents above the ordinary form limit', () => {
    const f = fixture('a'.repeat(20_000)), editor = f.open(20_000)
    expect(editor.content.length).toBe(20_000)
    expect(() => editor.finish({kind: 'save', content: '新'.repeat(10_000)})).toThrow(/limit/)
    expect(readFileSync(f.path, 'utf8')).toBe(editor.content)
    expect(() => f.open(19_999)).toThrow(/limit/)
  })
  it('refuses invalid UTF-8 instead of silently replacing file bytes', () => {
    const f = fixture(); writeFileSync(f.path, Buffer.from([0xff]))
    expect(() => f.open()).toThrow()
  })
})
