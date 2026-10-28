// The threads repository's update: a null clears a field, since no field of the shape holds one, which is how an
// action (code no compiler checks) clears a thread's forced mode when onboarding ends
import { expect, it } from 'vitest'
import { repository } from '#generated/repository.ts'
import { query, type EARS } from '#generated/ears.ts'

const thread = () => repository.threadCommands.create({ topic: 'Birth', instructions: '', forcedMode: 'Birth' }).id as EARS.EntityId<'Thread'>

it('clears a field given null, and writes the rest of the update', () => {
  const id = thread()
  repository.threadCommands.update(id, { forcedMode: null, topic: 'Welcome' })
  const row = query.ids(id).pickOne()!
  expect(row).not.toHaveProperty('forcedMode')
  expect(row.topic).toBe('Welcome')
  // A field already gone is no write, and no refusal
  expect(() => repository.threadCommands.update(id, { forcedMode: null })).not.toThrow()
})
