// The prompts list follows the data, not the system's own commands: a live query on every prompt tells the surface
// each one created, updated or deleted, whoever wrote it
import { describe, expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'

const promptsApp = async () => {
  const app = await startApp({ systems: ['prompts'] })
  await app.connect()
  return app
}

describe('the prompts list', () => {
  it('hears of a prompt written outside the prompts system, created, changed and deleted', async () => {
    const app = await promptsApp()
    // Written as an action or the Database console would: straight through the repository, announced by nothing
    const created = app.nextEmit('prompts', 'PROMPT_CREATED')
    const prompt = repository.promptCommands.create({ label: 'Elsewhere', inputs: {}, templateFn: 'return "hi"' })
    expect(await created).toMatchObject({ promptId: prompt.id, prompt: { label: 'Elsewhere' } })

    const updated = app.nextEmit('prompts', 'PROMPT_UPDATED')
    repository.promptCommands.update(prompt.id, { label: 'Renamed' })
    expect(await updated).toMatchObject({ promptId: prompt.id, prompt: { label: 'Renamed' } })

    const deleted = app.nextEmit('prompts', 'PROMPT_DELETED')
    repository.promptCommands.delete(prompt.id)
    expect(await deleted).toMatchObject({ promptId: prompt.id })
  })
})
