// A query's result goes to the view that ran it, not to every window.
//
// Two windows each show the Database surface with their own editor and their own pending request, and a
// `broadcast` reached both. An ask is answered to its sender, on the connection it came from — so a person querying in one window and an agent driving in another stop seeing each other's
// results.
//
// What this file cannot check is the *delivery narrowing*: the harness has one client, so `emitted` sees
// whatever the bus put out whether or not it was addressed. The addressing itself is covered where it lives
// (`@apackdev/host`'s `tests/bus/reply.spec.ts` and `@app/server`'s `tests/transport/sub-scope.spec.ts`). What is
// covered here is the pack's half: that the handler answers its sender at all.
//
// Every case connects first: the bus holds sends to surfaces until a client does, so an answer would otherwise
// have nowhere to go. The one case that deliberately does not is the last.
import { describe, expect, it } from 'vitest'
import { mockService, startApp } from '@apackdev/testing/harness'
import { UnknownBackupDatabasesError } from '@apackdev/sdk/services'

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
  const window = { client: WINDOW }

  it('is answered to the window that asked', async () => {
    const app = await startApp({ systems: ['database'] })
    await app.connect()

    expect(await app.ask('database', { type: 'EXECUTE_QUERY', code: 'return 1 + 1' }, window))
      .toMatchObject({ ok: true, value: { result: 2 } })
  })

  it('answers a failing query with why, and only that', async () => {
    const app = await startApp({ systems: ['database'] })
    await app.connect()

    expect(await app.ask('database', { type: 'EXECUTE_QUERY', code: 'return nope' }, window))
      .toMatchObject({ ok: false, failure: { kind: 'failed' } })
    expect(app.emitted('database').filter((event) => event.type === 'ASK_ANSWERED'), 'and not also a result').toEqual([])
  })

  /**
   * Two queries in flight, each answered to its own ask.
   *
   * The handler is `async` on a state with no re-entry guard, so the second ask is taken while the first is still
   * awaiting. Nothing in the system stores the call: each answer goes out under the delivery its handler was entered
   * in, and this is what fails if that were ever the latest delivery instead.
   */
  it('answers two overlapping queries each to its own ask', async () => {
    const app = await startApp({ systems: ['database'] })
    await app.connect()

    const [first, second] = await Promise.all([
      app.ask('database', { type: 'EXECUTE_QUERY', code: 'return "first"' }, window),
      app.ask('database', { type: 'EXECUTE_QUERY', code: 'return "second"' }, window),
    ])
    expect(first).toMatchObject({ ok: true, value: { result: 'first' } })
    expect(second).toMatchObject({ ok: true, value: { result: 'second' } })
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

    await expect(app.nextEmit('database', 'ASK_ANSWERED', { timeoutMs: 200 }))
      .rejects.toThrow(/No client has connected/)
  })

  /**
   * The schema is fetched, and only the window that ran a transaction asks for it again.
   *
   * It walks the whole store, so it is no view a commit should re-run, and a transaction tells nobody else: another
   * window shows the schema it last asked for until it asks again.
   */
  it('answers a transaction to its asker alone', async () => {
    const app = await startApp({ systems: ['database'] })
    await app.connect()

    expect(await app.ask('database', { type: 'EXECUTE_TRANSACTION', code: 'return 1' }, window)).toMatchObject({ ok: true })
    await app.settle()
    expect(app.emitted('database'), 'nothing broadcast to the other windows').toEqual([])
  })
})

describe('replacing the data', () => {
  const window = { client: WINDOW }

  it('answers the window that imported, and tells every window the data was replaced', async () => {
    mockService('appData', { importBackup: async () => ({ databases: ['lmdb'], missingDatabases: [], unknownEntityTypes: [] }) })
    const app = await startApp({ systems: ['database'] })
    await app.connect()

    expect(await app.ask('database', { type: 'IMPORT_DATABASE', path: '/backups/1' }, window))
      .toEqual({ ok: true, value: { message: 'Import successful. Please restart the brain manually.' } })
    expect(app.emitted('database')).toContainEqual({ type: 'DATABASE_REPLACED' })
  })

  // The user decides whether to import it without them, so the stores reach the window as data, not as wording
  it("refuses a newer apack's backup naming the stores it holds that this one doesn't", async () => {
    mockService('appData', { importBackup: async () => { throw new UnknownBackupDatabasesError(['searchIndex']) } })
    const app = await startApp({ systems: ['database'] })
    await app.connect()

    expect(await app.ask('database', { type: 'IMPORT_DATABASE', path: '/backups/1' }, window))
      .toMatchObject({ ok: false, failure: { kind: 'unknown-databases', unknownDatabases: ['searchIndex'] } })
    expect(app.emitted('database'), 'nothing was replaced').not.toContainEqual({ type: 'DATABASE_REPLACED' })
  })
})

describe('generating a query', () => {
  it('refuses an empty prompt to the window that asked', async () => {
    const app = await startApp({ systems: ['database'] })
    await app.connect()

    expect(await app.ask('database', { type: 'GENERATE_AI_QUERY', prompt: '  ' }, { client: WINDOW }))
      .toMatchObject({ ok: false, failure: { kind: 'failed', message: 'Please provide a valid prompt' } })
  })
})
