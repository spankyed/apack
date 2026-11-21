// One example covering what the app does: a backend with three systems, two windows each running the threads
// surface, a reply written on the backend and broadcast as it is written, and windows that leave part-way.
//
//   backend   library   answers GET_DOCUMENT
//             brain     is told TRIGGER_BRAIN_EVENT
//             threads   answers CREATE_THREAD and USER_MSG, and starts a state for each thread
//             a thread  idle | writing: writes its reply, broadcasts it, and holds its messages
//   window    threads   list → creating → thread { idle | sending }, with a private `draft` it starts
//
// Who owns a piece of work decides when it stops. Checking a message before it is sent is for whoever asked, so it is
// the ask's and stops if they go. Writing the reply is not: a message that was accepted is answered whether or not
// the window that sent it is still there. So the reply is the thread's own work, and the ask only starts it.
//
// Names follow the app's (USER_MSG, TRIGGER_BRAIN_EVENT, THREAD_CREATED, GET_DOCUMENT). Two things are simplified so
// that this one file runs: a thread keeps its messages in its own data where the app uses a repository, and it writes
// from `inference` directly where the app goes through a brain flow. `findDocument` stands for `libraryService.find`
// and `inference` for `services.inference`.

import { deepStrictEqual } from 'node:assert'
import { answered, given, reaching, system, within, type AskFailure, type Each } from './state.mts'

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

/** The threads system takes no events: everything that changes it is an ask, which answers. */
type ThreadsEvent = never
type ThreadsAsks = {
  CREATE_THREAD: { args: { title: string }; answer: { threadId: string } }
  /** Answered once the message is accepted. The reply is written afterwards, and broadcast. */
  USER_MSG: {
    args: { threadId: string; text: string; documentId?: string }
    answer: { accepted: true }
    // Kinds alone, or a kind with the data its refusal carries
    refuses: { 'no-such-thread': {}; 'attachment-missing': { documentId: string }; busy: {} }
  }
}

/** What a thread answers. Only the threads system, which starts it, can ask. */
type ThreadAsks = {
  WRITE: { args: { text: string; attached: string }; answer: 'accepted'; refuses: 'busy' }
}

type ThreadsSurfaceEvent =
  // from the user
  | { type: 'NEW_THREAD'; title: string }
  | { type: 'OPEN_THREAD'; threadId: string }
  | { type: 'BACK' }
  | { type: 'TYPE'; text: string }
  | { type: 'SEND'; documentId?: string }
  // broadcast by the backend to every window
  | { type: 'THREAD_CREATED'; threadId: string; title: string }
  | { type: 'REPLY_TEXT'; threadId: string; text: string }       // each piece of a reply, as it is written
  | { type: 'THREAD_CHANGED'; threadId: string; reply: string }  // a reply is whole

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
// Backend 3: threads, and a state for each thread. Asks the library, tells the brain, broadcasts to every window.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

type Inference = { streamText(prompt: string, signal: AbortSignal): AsyncIterable<string> }

type Thread = {
  data: { threadId: string; messages: string[] }
  states: { idle: {}; writing: { data: { text: string; attached: string } } }
}

/** One thread. It owns its messages and the writing of its reply, which goes on whoever asked for it. */
function thread(inference: Inference) {
  return state<Thread, never, ThreadAsks>()({
    // Which thread it is is given by whoever starts it.
    data: { threadId: given, messages: [] },
    start: 'idle',

    states: {
      idle: {
        // Accepting and starting to write are one step, so two messages at once cannot both be accepted.
        asks: { WRITE: ({ text, attached }) => answered('accepted' as const, { at: 'writing', data: { text, attached } }) },
      },

      writing: {
        data: { text: given, attached: given },

        // The innermost state that answers an ask wins: while writing, another message is refused.
        asks: { WRITE: (_, { data, refuse }) => { throw refuse('busy', `A reply is already being written in ${data.threadId}.`) } },

        async run({ data, tell, broadcast, signal }) {
          const { threadId } = data
          // tell another backend system, by name
          tell('brain', { type: 'TRIGGER_BRAIN_EVENT', eventType: 'threads.user_msg', payload: { threadId } })

          // to that surface in every window. `signal` aborts only if this thread stops being written to.
          let reply = ''
          for await (const piece of inference.streamText(data.text + data.attached, signal)) {
            reply += piece
            broadcast('threads', { type: 'REPLY_TEXT', threadId, text: piece })
          }

          broadcast('threads', { type: 'THREAD_CHANGED', threadId, reply })
          return { at: 'idle', data: (d) => { d.messages.push(d.text, reply) } }
        },

        failed: (error, { data, broadcast }) => {
          broadcast('threads', { type: 'THREAD_CHANGED', threadId: data.threadId, reply: `(no reply: ${error instanceof Error ? error.message : String(error)})` })
          return { at: 'idle' }
        },
      },
    },
  })
}

type Threads = {
  data: { titles: Record<string, string> }
  // A thread for each title. Which threads run is not kept anywhere else: it follows from the titles.
  starts: { thread: Each<ReturnType<typeof thread>> }
}

function threads(inference: Inference) {
  return state<Threads, ThreadsEvent, ThreadsAsks>()({
    data: { titles: {} },

    starts: (start) => ({
      // A thread for each title, told which it is.
      thread: start(thread(inference), { each: 'titles', given: (threadId) => ({ threadId }) }),
    }),

    asks: {
      // Answers and changes data as one step, and the thread is running by the end of it: adding its title is what
      // starts it. Nobody is told a thread exists that was not made.
      CREATE_THREAD: ({ title }, { data, broadcast }) => {
        const threadId = `THR-${Object.keys(data.titles).length + 1}`
        // to that surface in every window
        broadcast('threads', { type: 'THREAD_CREATED', threadId, title })
        return answered({ threadId }, { data: (d) => { d.titles[threadId] = title } })
      },

      // Checks the message, for whoever asked: if they go, this stops, and nothing has been started.
      async USER_MSG({ threadId, text, documentId }, { data, ask, child, refuse }) {
        if (!(threadId in data.titles)) throw refuse('no-such-thread', `There is no thread ${threadId}.`)

        // ask another backend system, by name
        let attached = ''
        if (documentId) {
          const found = await ask('library', 'GET_DOCUMENT', { id: documentId })
          if (!found.ok) throw refuse('attachment-missing', found.failure.message, { documentId })
          attached = ` [with ${found.value.document.name}]`
        }

        // ask the thread, a state this one started. From here the reply is the thread's, and this ask is done.
        const accepted = await ask(child('thread', threadId), 'WRITE', { text, attached })
        if (!accepted.ok) throw refuse('busy', accepted.failure.message)
        return { accepted: true as const }
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
      data: { threadId: string; lastReply: string | null; streamed: string }
      // What the composer holds. It runs exactly as long as a thread is open.
      starts: { draft: typeof draft }
      states: {
        idle: {}
        sending: { data: { text: string; documentId: string | null } }
      }
    }
  }
}

const withUnseen = (unseen: string[], threadId: string): string[] => (unseen.includes(threadId) ? unseen : [...unseen, threadId])

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
        data: { threadId, lastReply: null, streamed: '', unseen: data.unseen.filter((id) => id !== threadId) },
      }),

      // broadcast by the backend
      THREAD_CREATED: ({ threadId, title }, { data }) => ({ data: { titles: { ...data.titles, [threadId]: title } } }),

      // A thread changed while none is showing.
      THREAD_CHANGED: ({ threadId }, { data }) => ({ data: { unseen: withUnseen(data.unseen, threadId) } }),
    },

    states: {
      list: {},

      // ── creating: ask the backend, then go where the answer says ──────────────────────────────────────────────────
      creating: {
        data: { title: given },

        async run({ data, ask }) {
          const made = await ask('threads', 'CREATE_THREAD', { title: data.title })
          if (!made.ok) return { at: 'list', data: { problem: made.failure.message } }
          return { at: 'thread', data: { threadId: made.value.threadId, lastReply: null, streamed: '', problem: null } }
        },

        // A refusal is a value and is handled above. This is for what was not expected: a bug in `run` itself.
        failed: (error) => ({ at: 'list', data: { problem: error instanceof Error ? error.message : String(error) } }),
      },

      // ── thread: a state with states inside it ─────────────────────────────────────────────────────────────────────
      thread: {
        data: { threadId: given, lastReply: given, streamed: given },
        start: 'idle',

        starts: () => ({ draft }),

        run({ data, use }) {
          log(`composer mounted for ${data.threadId}`)
          use(() => log(`composer unmounted for ${data.threadId}`))
        },

        on: {
          TYPE: ({ text }, { tell, child }) => { tell(child('draft'), { type: 'DRAFT_CHANGED', text }) },

          // A reply is broadcast as it is written, whoever sent the message it answers: this window shows it for the
          // thread it has open, and for no other.
          REPLY_TEXT: ({ threadId, text }, { data }) => (threadId === data.threadId ? { data: { streamed: data.streamed + text } } : undefined),

          THREAD_CHANGED: ({ threadId, reply }, { data }) => (threadId === data.threadId
            ? { data: { lastReply: reply, streamed: '' } }
            : { data: { unseen: withUnseen(data.unseen, threadId) } }),
        },

        states: {
          idle: {
            on: {
              SEND: ({ documentId }, { read, child }) => {
                const text = read(child('draft')).data.text
                if (!text) return { data: { problem: 'There is nothing to send.' } }
                return { at: 'thread.sending', data: { text, documentId: documentId ?? null, problem: null } }
              },
            },
          },

          sending: {
            data: { text: given, documentId: given },

            // Waits only for the message to be accepted. The reply arrives by broadcast, above.
            async run({ data, ask }) {
              const sent = await ask('threads', 'USER_MSG', { threadId: data.threadId, text: data.text, documentId: data.documentId ?? undefined })

              if (sent.ok) return { at: 'thread.idle' }
              // Checking the kind narrows to what that refusal carries
              if (sent.failure.kind === 'attachment-missing') return { at: 'thread.idle', data: { problem: `Could not attach ${sent.failure.documentId}: ${sent.failure.message}` } }
              if (sent.failure.kind === 'disconnected') return { at: 'thread.idle', data: { problem: 'The connection was lost while sending.' } }
              return { at: 'thread.idle', data: { problem: sent.failure.message } }
            },

            failed: (error) => ({ at: 'thread.idle', data: { problem: error instanceof Error ? error.message : String(error) } }),

            on: {
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
    data: { titles: {} },
    starts: (start) => ({ thread: start(thread(undefined as never), { each: 'titles', given: (threadId) => ({ threadId }) }) }),
    asks: {
      CREATE_THREAD: () => ({ threadId: 'THR-1' }),
      // @ts-expect-error `attachment-missing` carries the document's id, so it cannot be refused without one
      USER_MSG: async (_, { refuse }) => { throw refuse('attachment-missing', 'no') },
    },
  })

  state<Threads, ThreadsEvent, ThreadsAsks>()({
    data: { titles: {} },
    starts: (start) => ({ thread: start(thread(undefined as never), { each: 'titles', given: (threadId) => ({ threadId }) }) }),
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
  // What each step must leave behind. The lines printed at the end are for reading; these are what is checked.
  let held = 0
  const holds = (what: string, actual: unknown, expected: unknown): void => {
    try { deepStrictEqual(actual, expected) } catch (error) { console.log(lines.join('\n')); throw new Error(`${what}\n${String(error)}`) }
    held++
  }

  const documents = new Map([['DOC-1', { id: 'DOC-1', name: 'Launch plan' }]])
  let aborted = 0
  const inference = {
    async *streamText(prompt: string, signal: AbortSignal): AsyncIterable<string> {
      for (const piece of ['You said: ', prompt, '.']) {
        await turns(3)
        if (signal.aborted) { aborted++; throw signal.reason }
        yield piece
      }
    },
  }

  const backend = system({ side: 'backend' })
  // Finding a document takes a while, so that a window can go while it is being found.
  backend.start('library', library(async (id) => { await turns(4); return documents.get(id) }))
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
      const shown = [`at ${now.at}`, 'threadId' in d && d.threadId, d.streamed && `streamed "${d.streamed}"`, d.lastReply && `lastReply "${d.lastReply}"`,
        now.data.unseen.length && `unseen ${now.data.unseen.join(',')}`, now.data.problem && `problem "${now.data.problem}"`].filter(Boolean).join(' | ')
      say(`      ${name}   ${shown}`)
    })
    return { window, link, surface }
  }
  const a = open('window A')
  const b = open('window B')
  /** What a window shows, with the fields that are only there in some states as null where they are not. */
  const shows = (of: typeof a) => {
    const now = of.window.read(of.surface)
    const d = now.data as { threadId?: string; lastReply?: string | null; streamed?: string; unseen: string[]; problem: string | null }
    return { at: now.at, threadId: d.threadId ?? null, streamed: d.streamed ?? null, lastReply: d.lastReply ?? null, unseen: d.unseen, problem: d.problem }
  }
  const stored = (): string[] => (backend.snapshot()['threads/thread/THR-1'] as { data: Thread['data'] }).data.messages

  say('A creates a thread: both windows hear THREAD_CREATED, only A opens it')
  a.window.send(a.surface, { type: 'NEW_THREAD', title: 'Plan' });                 await turns(8)
  holds('A is in the thread it made', shows(a), { at: 'thread.idle', threadId: 'THR-1', streamed: '', lastReply: null, unseen: [], problem: null })
  holds('B is still at its list', shows(b), { at: 'list', threadId: null, streamed: null, lastReply: null, unseen: [], problem: null })

  say('A types and sends: the message is accepted at once, and the reply is written by the thread and broadcast')
  a.window.send(a.surface, { type: 'TYPE', text: 'hello' })
  a.window.send(a.surface, { type: 'SEND' });                                      await turns(6)
  holds('A is no longer sending, and sees the reply as far as it has been written', shows(a), { at: 'thread.idle', threadId: 'THR-1', streamed: 'You said: ', lastReply: null, unseen: [], problem: null })

  say('A sends again while the reply is being written: the thread refuses it')
  a.window.send(a.surface, { type: 'SEND' });                                      await turns(3)
  holds('the second message is refused as busy', shows(a).problem, 'A reply is already being written in THR-1.')
  await turns(14)
  holds('A has the whole reply', shows(a), { at: 'thread.idle', threadId: 'THR-1', streamed: '', lastReply: 'You said: hello.', unseen: [], problem: 'A reply is already being written in THR-1.' })
  holds('B was told the thread changed, and shows none of the reply', shows(b), { at: 'list', threadId: null, streamed: null, lastReply: null, unseen: ['THR-1'], problem: null })

  say('A sends with an attachment the library does not have: a typed refusal')
  a.window.send(a.surface, { type: 'SEND', documentId: 'DOC-404' });               await turns(14)
  holds('the refusal carries the document it could not attach', shows(a), { at: 'thread.idle', threadId: 'THR-1', streamed: '', lastReply: 'You said: hello.', unseen: [], problem: 'Could not attach DOC-404: Document not found' })

  say('A sends with one it does have: threads asks the library, then the thread writes')
  a.window.send(a.surface, { type: 'SEND', documentId: 'DOC-1' });                 await turns(26)
  holds('the reply names the document the library gave', shows(a), { at: 'thread.idle', threadId: 'THR-1', streamed: '', lastReply: 'You said: hello [with Launch plan].', unseen: [], problem: null })

  say('B opens the thread, sends, and goes back to its list while the reply is being written')
  b.window.send(b.surface, { type: 'OPEN_THREAD', threadId: 'THR-1' })
  b.window.send(b.surface, { type: 'TYPE', text: 'anyone there' })
  b.window.send(b.surface, { type: 'SEND' });                                      await turns(6)
  b.window.send(b.surface, { type: 'BACK' });                                      await turns(16)
  holds('the reply was written all the same: A, which has the thread open, shows it', shows(a).lastReply, 'You said: anyone there.')
  holds('B, at its list, is told the thread changed', shows(b), { at: 'list', threadId: null, streamed: null, lastReply: null, unseen: ['THR-1'], problem: null })
  holds('and the thread holds the message and its reply', stored().slice(-2), ['anyone there', 'You said: anyone there.'])

  say('B opens it again, sends with an attachment, and its connection closes while the library is still looking')
  b.window.send(b.surface, { type: 'OPEN_THREAD', threadId: 'THR-1' })
  b.window.send(b.surface, { type: 'TYPE', text: 'one more' })
  b.window.send(b.surface, { type: 'SEND', documentId: 'DOC-1' });                 await turns(2)
  const before = stored().length
  b.link.close();                                                                  await turns(20)
  holds('B is told the connection was lost', shows(b), { at: 'thread.idle', threadId: 'THR-1', streamed: '', lastReply: null, unseen: [], problem: 'The connection was lost while sending.' })
  holds('checking the message was for B, so it stopped with B: nothing was written', stored().length, before)

  say('from outside: ask the brain how many events it was told')
  const fired = await backend.ask(theBrain, 'COUNT_FIRED', {})
  say(`      backend    COUNT_FIRED → ${JSON.stringify(fired)}`)
  say(`      backend    THR-1 holds ${JSON.stringify(stored())}`)
  holds('the brain was told of each message that was accepted, and of no other', fired, { ok: true, value: 3 })
  holds('the thread holds what was said and answered', stored(), ['hello', 'You said: hello.', 'hello', 'You said: hello [with Launch plan].', 'anyone there', 'You said: anyone there.'])
  holds('no reply was cut short by a window going', aborted, 0)

  console.log(lines.join('\n'))
  console.log(`\n${held} things held`)
  a.window.stop(); b.window.stop(); backend.stop()
}

// ── `within`: what must not compile ─────────────────────────────────────────────────────────────────────────────────

function withinMustNotCompile(value: import('./state.mts').Value<ThreadsSurface>): void {
  // @ts-expect-error a thread's id exists only somewhere inside `thread`
  void value.data.threadId
  if (within(value, 'thread')) void value.data.threadId
  if (within(value, 'thread.sending')) void value.data.documentId
  // @ts-expect-error there is no such state to be inside
  within(value, 'board')
  // @ts-expect-error inside `thread` is not enough to know it is sending
  if (within(value, 'thread')) void value.data.documentId
}
void withinMustNotCompile
