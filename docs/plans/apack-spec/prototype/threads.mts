// One example covering what the app does: a backend with three systems, two windows each running the threads
// surface, a request that streams, a notification to every window, and a window that disconnects mid-stream.
//
//   backend   library   answers GET_DOCUMENT
//             brain     is told TRIGGER_BRAIN_EVENT
//             threads   answers CREATE_THREAD and USER_MSG; streams; broadcasts
//   window    threads   list → creating → thread { idle | sending }, with a private `draft` it starts
//
// Names follow the app's (USER_MSG, TRIGGER_BRAIN_EVENT, THREAD_CREATED, GET_DOCUMENT). Two things are simplified so
// that this one file runs: threads keeps its rows in its own data where the app uses a repository, and it streams
// from `inference` directly where the app goes through a brain flow. `findDocument` stands for `libraryService.find`
// and `inference` for `services.inference`.

import { given, reaching, system, within, type AskFailure } from './state.mts'

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// What can be reached by name. In the app a pack's generated facade would declare this.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

type LibraryAsks = {
  GET_DOCUMENT: { args: { id: string }; answer: { document: { id: string; name: string } }; refuses: 'not-found' }
}

type BrainEvent =
  | { type: 'TRIGGER_BRAIN_EVENT'; eventType: string; payload: { threadId: string } }
type BrainAsks = {
  COUNT_FIRED: { args: {}; answer: number }
}

type ThreadsEvent =
  | { type: 'THREAD_ADDED'; threadId: string; title: string }
  | { type: 'MESSAGE_STORED'; threadId: string; text: string; reply: string }
type ThreadsAsks = {
  CREATE_THREAD: { args: { title: string }; answer: { threadId: string } }
  USER_MSG: {
    args: { threadId: string; text: string; documentId?: string }
    progress: { text: string }                                   // each piece of the reply, as it is written
    answer: { reply: string }
    // Kinds alone, or a kind with the data its refusal carries
    refuses: { 'no-such-thread': {}; 'attachment-missing': { documentId: string } }
  }
}

type ThreadsSurfaceEvent =
  // from the user
  | { type: 'NEW_THREAD'; title: string }
  | { type: 'OPEN_THREAD'; threadId: string }
  | { type: 'BACK' }
  | { type: 'TYPE'; text: string }
  | { type: 'SEND'; documentId?: string }
  // from its own work
  | { type: 'TEXT_APPENDED'; text: string }
  // broadcast by the backend to every window
  | { type: 'THREAD_CREATED'; threadId: string; title: string }
  | { type: 'THREAD_CHANGED'; threadId: string }

type App = {
  systems: {
    library: { events: never; asks: LibraryAsks }
    brain:   { events: BrainEvent; asks: BrainAsks }
    threads: { events: ThreadsEvent; asks: ThreadsAsks }
  }
  surfaces: {
    threads: { events: ThreadsSurfaceEvent }
  }
  views: {}
}

const state = reaching<App>()

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Backend 1: library. Answers one ask.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

function library(findDocument: (id: string) => Promise<{ id: string; name: string } | undefined>) {
  return state<{}, never, LibraryAsks>()({
    asks: {
      async GET_DOCUMENT({ id }, { refuse }) {
        const document = await findDocument(id)
        if (!document) throw refuse('not-found', 'Document not found')
        return { document }
      },
    },
  })
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Backend 2: brain. Told events by other systems; answers how many it has had.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const brain = state<{ data: { fired: string[] } }, BrainEvent, BrainAsks>()({
  data: { fired: [] },

  asks: {
    COUNT_FIRED: (_, { data }) => data.fired.length,
  },

  on: {
    TRIGGER_BRAIN_EVENT: ({ eventType }, { data }) => ({ data: { fired: [...data.fired, eventType] } }),
  },
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Backend 3: threads. Asks the library, tells the brain, streams to whoever asked, broadcasts to every window.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

type Threads = {
  data: { titles: Record<string, string>; messages: Record<string, string[]> }
}

function threads(inference: { streamText(prompt: string, signal: AbortSignal): AsyncIterable<string> }) {
  return state<Threads, ThreadsEvent, ThreadsAsks>()({
    data: { titles: {}, messages: {} },

    asks: {
      // An ask answers; it does not change data. To change data it tells itself an event.
      CREATE_THREAD: ({ title }, { data, send }) => {
        const threadId = `THR-${Object.keys(data.titles).length + 1}`
        send({ type: 'THREAD_ADDED', threadId, title })
        return { threadId }
      },

      async USER_MSG({ threadId, text, documentId }, { data, ask, tell, send, progress, refuse, signal }) {
        if (!(threadId in data.titles)) throw refuse('no-such-thread', `There is no thread ${threadId}.`)

        // ask another backend system, by name
        let attached = ''
        if (documentId) {
          const found = await ask('library', 'GET_DOCUMENT', { id: documentId })
          if (!found.ok) throw refuse('attachment-missing', found.failure.message, { documentId })
          attached = ` [with ${found.value.document.name}]`
        }

        // tell another backend system, by name
        tell('brain', { type: 'TRIGGER_BRAIN_EVENT', eventType: 'threads.user_msg', payload: { threadId } })

        // stream to whoever asked, and nobody else. `signal` aborts if they go away.
        let reply = ''
        for await (const piece of inference.streamText(text + attached, signal)) {
          reply += piece
          progress({ text: piece })
        }

        send({ type: 'MESSAGE_STORED', threadId, text, reply })
        return { reply }
      },
    },

    on: {
      THREAD_ADDED: ({ threadId, title }, { broadcast }) => {
        // to that surface in every window
        broadcast('threads', { type: 'THREAD_CREATED', threadId, title })
        return { data: (d) => { d.titles[threadId] = title; d.messages[threadId] = [] } }
      },

      MESSAGE_STORED: ({ threadId, text, reply }, { broadcast }) => {
        broadcast('threads', { type: 'THREAD_CHANGED', threadId })
        return { data: (d) => { d.messages[threadId]?.push(text, reply) } }
      },
    },
  })
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Window: the draft a thread's composer holds. Private to the surface, which starts it.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

type DraftEvent =
  | { type: 'DRAFT_CHANGED'; text: string }

const draft = state<{ data: { text: string } }, DraftEvent>()({
  data: { text: '' },

  on: {
    DRAFT_CHANGED: ({ text }) => ({ data: { text } }),
  },
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Window: the threads surface. One runs in each window.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

type ThreadsSurface = {
  data: { titles: Record<string, string>; unseen: string[]; problem: string | null }
  states: {
    list: {}
    creating: { data: { title: string } }
    thread: {
      data: { threadId: string; lastReply: string | null }
      states: {
        idle: {}
        sending: { data: { text: string; documentId: string | null; streamed: string } }
      }
    }
  }
}

function threadsSurface(log: (line: string) => void) {
  return state<ThreadsSurface, ThreadsSurfaceEvent>()({
    data: { titles: {}, unseen: [], problem: null },
    start: 'list',

    // Taken in every state, unless a state further in takes the same event first.
    on: {
      NEW_THREAD:  ({ title }) => ({ at: 'creating', data: { title } }),
      BACK:        ()          => ({ at: 'list' }),

      OPEN_THREAD: ({ threadId }, { data }) => ({
        at: 'thread',
        data: { threadId, lastReply: null, unseen: data.unseen.filter((id) => id !== threadId) },
      }),

      // broadcast by the backend
      THREAD_CREATED: ({ threadId, title }, { data }) => ({ data: { titles: { ...data.titles, [threadId]: title } } }),

      THREAD_CHANGED: ({ threadId }, { data, snapshot }) => {
        const showing = within(snapshot, 'thread') && snapshot.data.threadId === threadId
        if (showing || data.unseen.includes(threadId)) return
        return { data: { unseen: [...data.unseen, threadId] } }
      },
    },

    states: {
      list: {},

      // ── creating: ask the backend, then go where the answer says ──────────────────────────────────────────────────
      creating: {
        data: { title: given },

        async run({ data, ask }) {
          const made = await ask('threads', 'CREATE_THREAD', { title: data.title })
          if (!made.ok) return { at: 'list', data: { problem: made.failure.message } }
          return { at: 'thread', data: { threadId: made.value.threadId, lastReply: null, problem: null } }
        },
      },

      // ── thread: a state with states inside it ─────────────────────────────────────────────────────────────────────
      thread: {
        data: { threadId: given, lastReply: given },
        start: 'idle',

        run({ data, start, use }) {
          start('draft', draft)                                    // lives exactly as long as `thread` does
          log(`composer mounted for ${data.threadId}`)
          use(() => log(`composer unmounted for ${data.threadId}`))
        },

        on: {
          TYPE: ({ text }, { tell, child }) => { tell(child('draft', draft), { type: 'DRAFT_CHANGED', text }) },
        },

        states: {
          idle: {
            on: {
              SEND: ({ documentId }, { read, child }) => {
                const text = read(child('draft', draft)).data.text
                if (!text) return { data: { problem: 'There is nothing to send.' } }
                return { at: 'thread.sending', data: { text, documentId: documentId ?? null, streamed: '', problem: null } }
              },
            },
          },

          sending: {
            data: { text: given, documentId: given, streamed: given },

            async run({ data, ask, send }) {
              const sent = await ask(
                'threads', 'USER_MSG',
                { threadId: data.threadId, text: data.text, documentId: data.documentId ?? undefined },
                (updates) => send({ type: 'TEXT_APPENDED', text: updates.map((update) => update.text).join('') }),   // what was written since last heard
              )

              if (sent.ok) return { at: 'thread.idle', data: { lastReply: sent.value.reply } }
              // Checking the kind narrows to what that refusal carries
              if (sent.failure.kind === 'attachment-missing') return { at: 'thread.idle', data: { problem: `Could not attach ${sent.failure.documentId}: ${sent.failure.message}` } }
              if (sent.failure.kind === 'disconnected') return { at: 'thread.idle', data: { problem: 'The connection was lost while sending.' } }
              return { at: 'thread.idle', data: { problem: sent.failure.message } }
            },

            on: {
              TEXT_APPENDED: ({ text }, { data }) => ({ data: { streamed: data.streamed + text } }),
              // While sending, typing is ignored: the innermost state that takes an event wins.
              TYPE: () => {},
            },
          },
        },
      },
    },
  })
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// What must not compile: a refusal's data is part of the ask's declaration
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** Never called: it exists to be typechecked. */
function mustNotCompile(): void {

  state<Threads, ThreadsEvent, ThreadsAsks>()({
    data: { titles: {}, messages: {} },
    asks: {
      CREATE_THREAD: () => ({ threadId: 'THR-1' }),
      // @ts-expect-error `attachment-missing` carries the document's id, so it cannot be refused without one
      USER_MSG: async (_, { refuse }) => { throw refuse('attachment-missing', 'no') },
    },
  })

  state<Threads, ThreadsEvent, ThreadsAsks>()({
    data: { titles: {}, messages: {} },
    asks: {
      CREATE_THREAD: () => ({ threadId: 'THR-1' }),
      // @ts-expect-error `no-such-thread` carries nothing, so it takes no document id
      USER_MSG: async (_, { refuse }) => { throw refuse('no-such-thread', 'no', { documentId: 'DOC-1' }) },
    },
  })

  const failure = undefined as unknown as AskFailure<ThreadsAsks['USER_MSG']>
  // @ts-expect-error the document's id exists only once the kind is known to be `attachment-missing`
  void failure.documentId
  if (failure.kind === 'attachment-missing') void failure.documentId
}
void mustNotCompile

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Running it: one backend, two windows.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

if (process.argv[1]?.endsWith('threads.mts')) {
  const turns = (count: number): Promise<void> => new Promise((resolve) => { let left = count; const tick = (): void => { if (left-- <= 0) resolve(); else setImmediate(tick) }; tick() })
  const lines: string[] = []
  const say = (line: string): void => { lines.push(line) }

  const documents = new Map([['DOC-1', { id: 'DOC-1', name: 'Launch plan' }]])
  const inference = {
    async *streamText(prompt: string, signal: AbortSignal): AsyncIterable<string> {
      for (const piece of ['You said: ', prompt, '.']) {
        await turns(3)
        if (signal.aborted) { say('      backend    (inference aborted: whoever asked has gone)'); throw signal.reason }
        yield piece
      }
    },
  }

  const backend = system({ side: 'backend' })
  backend.start('library', library(async (id) => documents.get(id)))
  const theBrain = backend.start('brain', brain)
  backend.start('threads', threads(inference))

  const open = (name: string) => {
    const window = system({ side: 'window' })
    const link = window.connect(backend)
    const surface = window.start('threads', threadsSurface((line) => say(`      ${name}   (${line})`)))
    window.subscribe(() => {
      const now = window.read(surface)
      if (!now) return
      const d = now.data as Record<string, unknown>
      const shown = [`at ${now.at}`, 'threadId' in d && d.threadId, 'streamed' in d && `streamed "${d.streamed}"`, d.lastReply && `lastReply "${d.lastReply}"`,
        now.data.unseen.length && `unseen ${now.data.unseen.join(',')}`, now.data.problem && `problem "${now.data.problem}"`].filter(Boolean).join(' | ')
      say(`      ${name}   ${shown}`)
    })
    return { window, link, surface }
  }
  const a = open('window A')
  const b = open('window B')

  say('A creates a thread: both windows hear THREAD_CREATED, only A opens it')
  a.window.send(a.surface, { type: 'NEW_THREAD', title: 'Plan' });                 await turns(8)

  say('A types and sends: the reply streams to A only; B is told the thread changed')
  a.window.send(a.surface, { type: 'TYPE', text: 'hello' })
  a.window.send(a.surface, { type: 'SEND' });                                      await turns(20)

  say('A sends with an attachment the library does not have: a typed refusal')
  a.window.send(a.surface, { type: 'SEND', documentId: 'DOC-404' });               await turns(12)

  say('A sends with one it does have: threads asks the library, then streams')
  a.window.send(a.surface, { type: 'SEND', documentId: 'DOC-1' });                 await turns(20)

  say('B opens the thread, sends, and its connection closes mid-stream')
  b.window.send(b.surface, { type: 'OPEN_THREAD', threadId: 'THR-1' })
  b.window.send(b.surface, { type: 'TYPE', text: 'anyone there' })
  b.window.send(b.surface, { type: 'SEND' });                                      await turns(5)
  b.link.close();                                                                  await turns(12)

  say('from outside: ask the brain how many events it was told')
  say(`      backend    COUNT_FIRED → ${JSON.stringify(await backend.ask(theBrain, 'COUNT_FIRED', {}))}`)
  say(`      backend    threads holds ${JSON.stringify((backend.snapshot().threads as { data: Threads['data'] }).data.messages)}`)

  console.log(lines.join('\n'))
  a.window.stop(); b.window.stop(); backend.stop()
}

// ── `within`: what must not compile ─────────────────────────────────────────────────────────────────────────────────

function withinMustNotCompile(value: import('./state.mts').Value<ThreadsSurface>): void {
  // @ts-expect-error a thread's id exists only somewhere inside `thread`
  void value.data.threadId
  if (within(value, 'thread')) void value.data.threadId
  if (within(value, 'thread.sending')) void value.data.streamed
  // @ts-expect-error there is no such state to be inside
  within(value, 'board')
  // @ts-expect-error inside `thread` is not enough to know it is sending
  if (within(value, 'thread')) void value.data.streamed
}
void withinMustNotCompile
