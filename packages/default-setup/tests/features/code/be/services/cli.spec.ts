import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mockService } from '@apackdev/testing/harness'
import { services, type Services } from '#generated/services.ts'
import { cliService } from '#features/code/be/services/cli.ts'
import { action } from '../../../../../src/content/actions/claude-code/cc-command.ts'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'claude-settings-file-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', root)
  mockService<Services, 'cli'>('cli', { claudeCode: cliService.claudeCode } as never)
  mockService<Services, 'chat'>('chat', { sendBlockMessage: vi.fn() })
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})
const setModel = () => action({ command: 'cc-config', text: 'set model "fixture-model"', threadId: 'fixture-thread' }, services, {} as never, 'fixture-flow')

it.each(['{"privateFixtureSecret":"do-not-display",', 'null', '[]', '"privateFixtureSecret"', '42'])('preserves invalid settings bytes and refuses editing (%s)', async raw => {
  const file = join(root, 'settings.json')
  await writeFile(file, raw)
  const result = await setModel()
  expect(result.text).toContain('cc-config failed:')
  expect(result.text).not.toContain('privateFixtureSecret')
  expect(await readFile(file, 'utf8')).toBe(raw)
})
it('propagates an unreadable settings path instead of replacing it with an empty object', async () => {
  await mkdir(join(root, 'settings.json'))
  await expect(cliService.claudeCode.readSettings()).rejects.toMatchObject({ code: 'EISDIR' })
})
it('allows a missing file and preserves other keys when editing a valid object', async () => {
  expect(await cliService.claudeCode.readSettings()).toEqual({})
  await writeFile(join(root, 'settings.json'), JSON.stringify({ env: { FIXTURE: 'retained' }, nativeFutureField: { enabled: true } }))
  expect((await setModel()).text).toContain('Set model')
  expect(JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'))).toEqual({ env: { FIXTURE: 'retained' }, nativeFutureField: { enabled: true }, model: 'fixture-model' })
})
