import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { prepareClaudeMemoryPath } from '#features/code/be/services/claude-code/memory-files.ts'
import type { ClaudeMemoryDialog } from '#features/code/be/services/claude-code/host-controls.ts'

async function fixture(run: (root: string, file: string, folder: string, catalog: ClaudeMemoryDialog) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'claude-memory-files-'))
  const file = join(root, 'CLAUDE.md')
  const folder = join(root, 'memory')
  const catalog: ClaudeMemoryDialog = {
    files: [{ kind: 'project', path: file, label: 'Project instructions', exists: false }],
    folders: [{ path: folder, label: 'Open auto-memory folder' }],
    auto_memory: { enabled: true, toggleable: true, status: 'on' },
    auto_dream: { shown: false, status: 'off', detail: '' },
  }
  try { await run(root, file, folder, catalog) }
  finally { await rm(root, { recursive: true, force: true }) }
}

it('creates a listed instruction file once and preserves a file created before the click arrives', async () => {
  await fixture(async (_root, path, _folder, dialog) => {
    const request = { kind: 'createInstruction' as const, path }
    await expect(prepareClaudeMemoryPath(dialog, request, () => {})).resolves.toBe(path)
    expect(await readFile(path, 'utf8')).toBe('')
    await writeFile(path, 'Keep existing instructions.\n')
    dialog.files[0]!.exists = true
    await expect(prepareClaudeMemoryPath(dialog, request, () => {})).resolves.toBe(path)
    expect(await readFile(path, 'utf8')).toBe('Keep existing instructions.\n')
  })
})

it('prepares only a folder in the latest native catalog and refuses after the view retires', async () => {
  await fixture(async (root, _file, path, dialog) => {
    const retired = join(root, 'retired')
    await expect(prepareClaudeMemoryPath(dialog, { kind: 'openFolder', path: retired }, () => {})).rejects.toThrow('no longer available')
    await expect(prepareClaudeMemoryPath(dialog, { kind: 'openFolder', path }, () => { throw new Error('view changed') }))
      .rejects.toThrow('view changed')
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(prepareClaudeMemoryPath(dialog, { kind: 'openFolder', path }, () => {})).resolves.toBe(path)
    expect((await stat(path)).isDirectory()).toBe(true)
  })
})
