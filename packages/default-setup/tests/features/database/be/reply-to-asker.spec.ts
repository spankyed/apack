// A query's result goes to the view that ran it, not to every window.
//
// Two windows each show the Database surface with their own editor and their own pending request, and a
// `broadcastToSurface` reached both. `reply` answers the sender of the message being handled, on the connection
// it came from — so a person querying in one window and an agent driving in another stop seeing each other's
// results.
//
// What this file cannot check is the *delivery narrowing*: the harness has one client, so `emitted` sees
// whatever the bus put out whether or not it was addressed. The addressing itself is covered where it lives
// (`@apackdev/host`'s `tests/bus/reply.spec.ts` and `@app/api`'s `tests/transport/sub-scope.spec.ts`). What is
// covered here is the pack's half: that the handler answers its sender at all.
//
// Every case connects first: the bus holds sends to surfaces until a client does, so an answer would otherwise
// have nowhere to go. The one case that deliberately does not is the last.
import { describe, expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'

const DATABASE = 'default-setup/database'
/**
 * The connection the ask arrived on, which is what makes these asks a *window's*.
 *
 * `reply` routes on it: with a connection the asker is a surface or a driver and the answer goes out to that
 * connection, without one the ask came from the backend and the answer goes to the asking system. A real
 * client's send always carries one, stamped per socket by the API; a send made from a test carries nothing
 * unless it says so. Every case here is a view running a query, so every case names one.
 */
const WINDOW = 'c-window'

describe('a query run by a surface', () => {
  /**
   * **The call is the ask's, and the answer names it on the envelope rather than in the payload.**
   *
   * `app.send` returns what it sent under, `reply` stamps it as `Message.answering`, and `nextEmit`'s
   * `answering` is what reads it. The event itself says nothing about which ask it belongs to, which is the
   * point: no event type declares a correlation field, so none can declare one and mint nothing.
   */
  it('is answered to the asker, naming the call it asked under', async () => {
    const app = await startApp({ systems: ['database'] })
    await app.connect()

    const call = await app.send('database', { type: 'EXECUTE_QUERY', code: 'return 1 + 1' }, { sender: DATABASE, client: WINDOW })
    const answer = await app.nextEmit('database', 'QUERY_RESULT', { answering: call })

    expect(answer).toMatchObject({ type: 'QUERY_RESULT', result: 2 })
  })

  // The failing path answers too, and answers once: the reply sits outside the try so a throw cannot send twice
  it('answers a failing query with the error, naming the same call', async () => {
    const app = await startApp({ systems: ['database'] })
    await app.connect()

    const call = await app.send('database', { type: 'EXECUTE_QUERY', code: 'return nope' }, { sender: DATABASE, client: WINDOW })
    const answer = await app.nextEmit('database', 'QUERY_ERROR', { answering: call })

    expect(answer).toMatchObject({ type: 'QUERY_ERROR' })
    expect(app.emitted('database').filter((event) => event.type === 'QUERY_RESULT'), 'and not also a result').toEqual([])
  })

  /**
   * Two queries in flight, each answered under its own call — the case the correlation exists for.
   *
   * The handler is `async` on a state with no re-entry guard, so the second ask is accepted while the first
   * is still awaiting. Nothing in the system stores the call: `reply` is bound to the delivery each handler
   * was entered in, so two answers carry two calls without the machine holding either. Written rather than
   * found, and it is what fails if `reply` is ever rebound to the latest delivery instead of its own.
   */
  it('answers two overlapping queries each under its own call', async () => {
    const app = await startApp({ systems: ['database'] })
    await app.connect()

    const first = await app.send('database', { type: 'EXECUTE_QUERY', code: 'return "first"' }, { sender: DATABASE, client: WINDOW })
    const second = await app.send('database', { type: 'EXECUTE_QUERY', code: 'return "second"' }, { sender: DATABASE, client: WINDOW })

    expect(first, 'two asks, two calls').not.toEqual(second)
    expect(await app.nextEmit('database', 'QUERY_RESULT', { answering: first })).toMatchObject({ result: 'first' })
    expect(await app.nextEmit('database', 'QUERY_RESULT', { answering: second })).toMatchObject({ result: 'second' })
  })

  /**
   * Why nothing arrived, when the reason is that nobody was listening.
   *
   * A handler that ran and answered correctly still fails with an empty `Sent:` list if no client connected,
   * and nothing distinguishes that from a handler that never ran — so the wait's own message has to say it.
   *
   * Deliberately no `app.connect()`. A short timeout because the point is the message, not the wait.
   */
  it('says why nothing arrived when no client has connected', async () => {
    const app = await startApp({ systems: ['database'] })

    await app.send('database', { type: 'EXECUTE_QUERY', code: 'return 1' }, { sender: DATABASE, client: WINDOW })

    await expect(app.nextEmit('database', 'QUERY_RESULT', { timeoutMs: 200 }))
      .rejects.toThrow(/No client has connected/)
  })

  /**
   * The schema is fetched, and only the window that ran a transaction asks for it again.
   *
   * It walks the whole store, so it is no view a commit should re-run, and a transaction tells nobody else: another
   * window shows the schema it last asked for until it asks again.
   */
  it('answers a transaction to its asker alone, and the schema to whoever asks for it', async () => {
    const app = await startApp({ systems: ['database'] })
    await app.connect()

    const ran = await app.send('database', { type: 'EXECUTE_TRANSACTION', code: 'return 1' }, { sender: DATABASE, client: WINDOW })
    await app.nextEmit('database', 'TRANSACTION_RESULT', { answering: ran })
    await app.settle()
    expect(app.emitted('database').map((event) => event.type), 'nothing broadcast beside the answer').toEqual(['TRANSACTION_RESULT'])

    repository.noteCommands.create({ title: 'Fresh', content: '' })
    const asked = await app.send('database', { type: 'GET_SCHEMA' }, { sender: DATABASE, client: WINDOW })
    const read = await app.nextEmit('database', 'SCHEMA_READ', { answering: asked }) as unknown as { schema: { entities: Array<{ type: string }> } }
    expect(read.schema.entities.map((entity) => entity.type)).toContain('Note')
  })
})
