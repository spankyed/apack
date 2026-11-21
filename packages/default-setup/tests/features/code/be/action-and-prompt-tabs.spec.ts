// An action's code and a prompt's template are edited in the code surface's tabs: opened from the entity, and saved
// back into it. The code system answers neither itself: each ask is forwarded by its prefix to the child that holds
// its handlers, and the answer still reaches whoever asked.
import { expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'

it("opens an action's code, saves it back into the action, and refuses one that is not there", async () => {
  const app = await startApp({ systems: ['code'] })
  await app.connect()
  const action = repository.actionCommands.create({ label: 'Tick', input: {}, actionFn: 'return 1' })

  expect(await app.ask('code', { type: 'codeActions.OPEN_ACTION', actionId: action.id }))
    .toMatchObject({ ok: true, value: { id: action.id, actionFnContent: 'return 1' } })
  expect(await app.ask('code', { type: 'codeActions.SAVE_ACTION', actionId: action.id, actionFn: 'return 2' }))
    .toMatchObject({ ok: true, value: { id: action.id, actionFn: 'return 2' } })
  expect(repository.actionQueries.byId(action.id)?.actionFn).toBe('return 2')
  expect(await app.ask('code', { type: 'codeActions.OPEN_ACTION', actionId: 'no-such-action' }))
    .toMatchObject({ ok: false, failure: { kind: 'not-found' } })
})

it("opens a prompt's template, saves it back into the prompt, and refuses one that is not there", async () => {
  const app = await startApp({ systems: ['code'] })
  await app.connect()
  const prompt = repository.promptCommands.create({ label: 'Greet', inputs: {}, templateFn: 'return "hi"' })

  expect(await app.ask('code', { type: 'codePrompts.OPEN_PROMPT', promptId: prompt.id }))
    .toMatchObject({ ok: true, value: { id: prompt.id, templateFnContent: 'return "hi"' } })
  expect(await app.ask('code', { type: 'codePrompts.SAVE_PROMPT', promptId: prompt.id, templateFn: 'return "yo"' }))
    .toMatchObject({ ok: true, value: { id: prompt.id, templateFn: 'return "yo"' } })
  expect(repository.promptQueries.byId(prompt.id)?.templateFn).toBe('return "yo"')
  expect(await app.ask('code', { type: 'codePrompts.OPEN_PROMPT', promptId: 'no-such-prompt' }))
    .toMatchObject({ ok: false, failure: { kind: 'not-found' } })
})
