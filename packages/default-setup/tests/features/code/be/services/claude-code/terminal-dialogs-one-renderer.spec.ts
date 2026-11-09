import { z } from 'zod'
import * as dialogs from '#features/code/be/services/claude-code/terminal-dialogs.ts'

/**
 * One element, one renderer: a dialog reaches this app only while the CLI holds exactly one open, so a
 * second one offers nothing rather than two cards the user could answer twice.
 *
 * Derived from the module's exports, so a dialog kind added without the bound arrives here as a failure
 * instead of being missed by a list nobody updated.
 */
const arrays = Object.entries(dialogs).flatMap(([name, schema]) =>
  name.endsWith('DialogsSchema') && schema instanceof z.ZodArray ? [[name, schema] as const] : [])

it('offers at most one dialog of every kind the module declares', () => {
  expect(arrays.length, 'nothing to check means this spec looked at nothing').toBeGreaterThan(5)
  // The item is deliberately not a valid dialog: what is asserted is the bound, which is checked before any
  // element is, so a schema that accepts two of *anything* fails here.
  const two = arrays.filter(([, schema]) => {
    const refusal = schema.safeParse([{}, {}])
    return refusal.success || !refusal.error.issues.some(issue => issue.code === 'too_big')
  })
  expect(two.map(([name]) => name), 'a second open dialog must offer nothing, not a second card').toEqual([])
})
