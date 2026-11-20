import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { FileSystemRepository } from '#features/code/be/services/filesystem.ts'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-files-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('searchFiles', () => {
  it('finds every match when ripgrep answers with more than one read holds', async () => {
    // About a megabyte of answer, in lines of several kilobytes: far more than a pipe hands over at once, so
    // lines are cut wherever a read ends. The text is two bytes a character, so a character is cut there too
    const FILES = 300
    const text = `needle ${'é'.repeat(1500)}`
    for (let index = 0; index < FILES; index++) fs.writeFileSync(path.join(dir, `file-${index}.txt`), `${text}\n`)

    const streamed: string[] = []
    const results = await new FileSystemRepository(dir).searchFiles({ query: 'needle', path: dir }, undefined, result => streamed.push(result.path))

    expect(results).toHaveLength(FILES)
    expect(new Set(streamed).size).toBe(FILES)
    expect(results.filter(result => result.matches.length !== 1 || result.matches[0].lineText !== text)).toEqual([])
  })
})
