// The schema view, as a window's `useView` hears it: another window's write shows at once, and a write that changes no
// name the view answers is never delivered.
import { describe, expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'
import type { DatabaseSchemaInfo } from '#features/database/be/types.ts'

describe('the schema view', () => {
  it('follows a write from anywhere, and hears nothing of one that changes no name', async () => {
    const app = await startApp({ systems: ['database'] })
    const schema = app.watchView<DatabaseSchemaInfo>('database', 'schema')
    const first = await schema.next()
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.entities.map((entity) => entity.type)).not.toContain('Note')

    const note = repository.noteCommands.create({ title: 'Fresh', content: '' })
    const created = await schema.next()
    if (!created.ok) throw new Error(created.error)
    expect(created.value.entities.map((entity) => entity.type)).toContain('Note')
    expect(created.value.attributes.map((attribute) => attribute.kind)).toContain('title')

    await app.settle()
    const heard = schema.updates.length
    repository.noteCommands.update(note.id, { title: 'Renamed' })
    await app.settle()
    expect(schema.updates, 'a rename moves no count and writes no new field').toHaveLength(heard)
  })
})
