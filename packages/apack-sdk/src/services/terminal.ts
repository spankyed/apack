/**
 * Terminal sessions, owned by the app and operated through this.
 *
 * **A pack never owns a pty.** It asks for a session and is handed something it can write to, resize and
 * end; the process lives in the broker, outside the API process, so no session's lifetime is the API's.
 * That is the whole of what this contract is for, and it is why the terminal feature has no `node-pty`
 * import to reach for.
 *
 * **Every operation is a promise, and that is a fact about the broker rather than a style.** The engine is
 * synchronous because elmdb is in-process; a session is a socket away, so a write cannot answer in the same
 * turn. Code that treats a write as settled when it returns is wrong about this contract.
 *
 * **This is the session as its owner holds it, and drawing one is not here.** An owner opens a session,
 * operates it and ends it. A window that draws it attaches to the broker as a view, over a connection of
 * its own (`terminalViews`, `@apackdev/sdk/fe`), named by the session's id — so any number of windows
 * draw one session, and a window closing detaches its view and ends nothing.
 */

/**
 * Something a session's program did that is not on its screen.
 *
 * Each is a moment, reported as it happens: a bell rung is gone, and a command that finished did so at a
 * time a caller asking `facts()` afterwards can only approximate. Every one is a claim the program made —
 * what to do about a title, a notification or text it wants on the clipboard is the owner's to decide.
 */
export type TerminalEvent =
  /** The program named its terminal. Empty when it took the name back */
  | { readonly kind: 'title'; readonly title: string }
  | { readonly kind: 'bell' }
  /** The program asked for this text to be put on the clipboard */
  | { readonly kind: 'clipboard'; readonly text: string }
  | { readonly kind: 'notification'; readonly title: string; readonly body: string }
  /** How far along the program says it is. `percent` is `null` where it gave none */
  | { readonly kind: 'progress'; readonly state: 'none' | 'running' | 'error' | 'indeterminate' | 'paused'; readonly percent: number | null }
  /** The shell is about to run a command, with the line it read where it said */
  | { readonly kind: 'commandStarted'; readonly command: string | null }
  /** What was running ended. `exitStatus` is `null` when the shell reported none, which is not zero */
  | { readonly kind: 'commandFinished'; readonly exitStatus: number | null }
  | { readonly kind: 'cwdChanged'; readonly cwd: string };

/** What a session's owner hears from it. All of it is news: nobody asked, and none of it answers a call. */
export interface TerminalListeners {
  /**
   * Bytes the process wrote, as they arrive.
   *
   * **Given by an owner that reads them, and left out by one that does not.** A caller parsing a
   * program's output, or forwarding it, wants the bytes. A terminal a person looks at is drawn by a
   * window from the rows its session sends (`terminalViews`, `@apackdev/sdk/fe`), and its owner has no
   * use for them: a session opened without this is not sent its bytes at all, and nothing has to keep up
   * with them. Which it is is fixed when the session is opened.
   */
  onOutput?(data: string): void;
  /** What the program did that is not on its screen, as it happens */
  onEvent?(event: TerminalEvent): void;
  /**
   * The process ended, however it ended: a code when it exited, the name of a signal when one killed it,
   * and never both.
   *
   * **A signal is not an exit code, and reporting one as the other loses what a window needed.** A shell the
   * user quit and a program the app terminated are the same `1` otherwise, so nothing can tell a crash it
   * should draw a seam for from the shutdown it asked for itself. Both are `null` when the end was inferred
   * rather than reported — the host lost its connection to the session's owner.
   */
  onExit(code: number | null, signal: string | null): void;
}

/**
 * What a session's shell has said about itself. Every field is a claim the program in the pty made.
 *
 * `cwd` is decoded but not shaped to the reading platform: an OSC 7 URL gives `/C:/Users/...` on Windows,
 * which nothing there can open, which is what `cwdAsReported` is for.
 */
export interface TerminalFacts {
  /** The working directory the shell last reported, or `null` if it has reported none */
  readonly cwd: string | null;
  /** The command line the shell last said it was about to run */
  readonly command: string | null;
  /** Between a command starting and finishing, which is a busy session told from one at a prompt */
  readonly running: boolean;
  /** The status the last finished command reported; `null` when none has, or it reported none */
  readonly exitStatus: number | null;
  /**
   * Moves each time the shell reports a command it started has ended. A command that starts and ends between
   * two reads leaves `running` false at both, and this is what says one ran. Compare it for a difference
   * only: it is not an exact number of commands, and it wraps
   */
  readonly finished: number;
}

/** A colour as `#rrggbb` */
export type TerminalColor = `#${string}`;

/** The colours a session is drawn in */
export interface TerminalColors {
  readonly foreground: TerminalColor;
  readonly background: TerminalColor;
  readonly cursor?: TerminalColor;
  /** The first entries of the palette, in order: the sixteen a theme names. Fewer leaves the rest alone */
  readonly ansi: readonly TerminalColor[];
}

/** One cell in pixels */
export interface TerminalCellSize {
  readonly width: number;
  readonly height: number;
}

/**
 * A signal a session's processes may be sent.
 *
 * A closed set rather than a number, because the point is a caller that cannot name something else: an
 * arbitrary one would make this an interface to `kill(2)` rather than to a session.
 */
export type TerminalSignal = 'SIGHUP' | 'SIGINT' | 'SIGQUIT' | 'SIGTERM' | 'SIGKILL';

/**
 * What a signal is sent to.
 *
 * **`group` is the process group the session's own process leads, and no more than that.** A shell with job
 * control puts each background job in a group of its own, so a group signal does not reach one — `terminate`
 * is what ends a session and everything under it. What a group is for is a program started directly and the
 * children it left in its own group.
 */
export type TerminalSignalScope =
  /** The process the host started for this session */
  | { readonly kind: 'leader' }
  /** The process group it leads */
  | { readonly kind: 'group' }
  /** One process, refused unless it is inside this session's tree */
  | { readonly kind: 'pid'; readonly pid: number };

/** One session, as its owner holds it */
export interface TerminalSession {
  /**
   * Which broker the session is on, as a window is told it to draw the session: `null` for this
   * machine's, and otherwise the key of the target it was opened on (`TerminalService.at`). A session's
   * `id` is its broker's name for it, so two sessions on different brokers may share one.
   */
  readonly target: string | null;
  /** The host's id for the session; a pack never invents one */
  readonly id: string;
  /**
   * The process id, for a diagnostic — **`null` when the host did not say**.
   *
   * Not a handle: nothing addresses a session by it, which is the whole of why a session has an `id`. It is
   * answered for a session the host just started and not for one it took up again after a restart, and a
   * number invented to fill that gap would tell a window that the shell it is drawing had been replaced.
   */
  readonly pid: number | null;
  /**
   * Whether what it prints is being recorded, as its host said when it started it: a recording that was
   * asked for and could not be opened leaves a session without one. `null` for a session taken up with
   * `adopt`, which `sessions()` answers for.
   */
  readonly recorded: boolean | null;
  /** Whether it began with the screen its recording held */
  readonly restored: boolean;
  /**
   * How many lines above the screen this session answers when its screen is read as text, from the
   * broker's handshake. What a window drawing the session can scroll back through is the broker's own
   * history, which is longer and is not this number.
   */
  readonly scrollback: number;
  /** Bytes the user typed */
  write(data: string): Promise<void>;
  /**
   * The viewport changed. One size per session, because a pty has one.
   *
   * `cell` is one cell in pixels as the window drawing the session measured it, which is what a program
   * asking for the terminal's size in pixels is told. An owner that measures nothing leaves it out, and
   * the last one given stands.
   */
  resize(cols: number, rows: number, cell?: TerminalCellSize): Promise<void>;
  /**
   * What the shell has reported about itself, as the host parsed it.
   *
   * **The markers are read where the bytes arrive, so nothing here reads them twice.** A shell's working
   * directory and command boundaries come from control sequences in its output, and the host already parses
   * them as it reads — including a sequence split across two reads, which a consumer watching chunks cannot
   * see. Asking is one round trip; parsing again is a second parser for one fact, and the copy that breaks.
   */
  facts(): Promise<TerminalFacts>;
  /**
   * Stops the session's pty being read, so the program in it feels the reader stop.
   *
   * **For an owner whose own sink is slower than a program can write** — output that has to be handed to
   * something that drains before the next of it can be taken. Taking the output more slowly is not the same
   * thing: one connection carries every session, so that slows all of them to slow one down.
   *
   * **The bytes are held by the kernel, not accumulated anywhere**: the pty's buffer fills and the program
   * blocks on its own write, so a pause is backpressure reaching it. Two things follow, and both are the
   * contract rather than a limitation — output a read already outstanding returns still arrives, and a
   * paused session's `scrollback` stops growing because nothing is being parsed. An exit is unaffected: it
   * is waited for on the process rather than read off the pty.
   */
  pause(): Promise<void>;
  /** Reads it again, and delivers what arrived while it was not being read */
  resume(): Promise<void>;
  /**
   * Whether `pid` is this session's own process or something it started, however deep.
   *
   * **A question, not a signal that happens to be refused.** The host checks exactly this before it signals
   * a pid, but a signal is an act — asking for the effect to learn the answer is the mistake this exists to
   * remove, and both come from one walk so the two cannot disagree.
   *
   * **What needs it is a claim an owner cannot check itself.** A process says *"I am yours, pid N"* over a
   * socket of its own, where the pid is whatever it chose to write, and admitting it is an authorization
   * decision about a tree the host owns. Walking the parent chain from outside answers the same question
   * with a second implementation, which can disagree with the one the host enforces — and off POSIX it
   * cannot answer at all.
   *
   * Refused where the platform cannot be asked, rather than answered `false`: a caller that cannot tell
   * "no" from "I could not look" would refuse every claim and say nothing about why.
   */
  owns(pid: number): Promise<boolean>;
  /**
   * Sends a signal to the session's process, its process group, or one process inside its tree.
   *
   * `terminate` ends a session and its tree, which is all a terminal needs. This is for an owner driving a
   * particular program and shutting it down the way that program documents: signal the program so the
   * servers it owns outlive its own shutdown handlers, then its group, then the group harder.
   *
   * **POSIX only**, and refused rather than approximated elsewhere — Windows has no signals. A pid outside
   * this session's tree is refused too, which is what makes naming one safe to offer: a pid is a number any
   * caller can produce, and signalling whatever one names would be an interface to every process the user
   * owns.
   */
  signal(signal: TerminalSignal, scope: TerminalSignalScope): Promise<void>;
  /** The commands the session's shell has reported, oldest first. A shell that marks none has none */
  commands(): Promise<readonly TerminalCommand[]>;
  /** What one of them printed, as text, or `null` for one whose output is no longer held */
  commandOutput(command: number): Promise<string | null>;
  /**
   * Whether the session goes on running when the app is not: kept, it is not ended when the app quits,
   * and `sessions()` finds it when the app next starts.
   */
  keep(kept: boolean): Promise<void>;
  /** Ends the session and its process tree. Explicit termination, as distinct from a view closing */
  terminate(): Promise<void>;
}

/** One command a session's shell reported. Everything but `id` is what the shell said */
export interface TerminalCommand {
  /** Counts from one in a session, and is never reused */
  readonly id: number;
  readonly command: string | null;
  readonly cwd: string | null;
  /** Milliseconds since the Unix epoch; `finishedMs` is `null` while it runs */
  readonly startedMs: number | null;
  readonly finishedMs: number | null;
  /** `null` while it runs, and when the shell reported none — which is not zero */
  readonly exitStatus: number | null;
}

/** A session that is running, as a caller that did not open it is told of it */
export interface TerminalSessionSummary {
  readonly id: string;
  readonly pid: number;
  readonly cols: number;
  readonly rows: number;
  /** Whether it was asked to outlive the app (`TerminalSession.keep`) */
  readonly kept: boolean;
  readonly recorded: boolean;
  /** What its program last named the terminal, and what its shell last said of itself */
  readonly title: string | null;
  readonly cwd: string | null;
  readonly command: string | null;
  readonly running: boolean;
}

/**
 * A recording opened to be looked back through. It is drawn like a session — a window attaches a view to
 * `id` — and has no process: what is typed at it goes nowhere.
 */
export interface TerminalRewind {
  readonly id: string;
  /** The moments the recording runs between, in milliseconds since the Unix epoch */
  readonly first: number;
  readonly last: number;
  /** Shows it as it was at `at`, answering the moment shown: `at` held to what the recording covers */
  seek(at: number): Promise<number>;
  resize(cols: number, rows: number, cell?: TerminalCellSize): Promise<void>;
  close(): Promise<void>;
}

/** How a pack opens a terminal session */
export interface TerminalService {
  /**
   * Starts a shell in a new session. `shell` absent takes the platform's default, `cwd` absent the
   * broker's.
   */
  open(
    options: {
      cols: number;
      rows: number;
      shell?: string;
      /**
       * The shell's own launch arguments, in order.
       *
       * **This is how shell integration is arranged.** The markers a terminal reads facts from — the working
       * directory, and the prompt and command boundaries — come from code the shell runs at startup, and
       * each shell takes that a different way: bash and PowerShell as an argument, zsh and fish as
       * environment. Typing it into the shell once it has started is the alternative, and it echoes, races
       * startup, needs a branch per shell and has none for PowerShell or cmd.
       */
      args?: readonly string[];
      /** Added to the environment the session is started in, which carries none of the app's own identity */
      env?: Readonly<Record<string, string>>;
      /**
       * Taken out of that environment, which `env` cannot express.
       *
       * **A session inherits the host's environment, so adding entries cannot make a name absent.** An owner
       * starting the user's shell wants that inheritance; one starting a particular program often wants the
       * opposite, and what it is usually subtracting is a credential — a CLI that found the app's own API
       * key in its environment would authenticate as the app rather than as whoever the user signed in as.
       *
       * Applied after `env`, so absence is what an owner gets when it asks for both.
       */
      unset?: readonly string[];
      cwd?: string;
      /**
       * What the session is drawn in, so a program that asks the terminal for its colours hears those.
       *
       * **The host answers that question and draws nothing**, so without this it answers with a palette
       * nobody is looking at — and a program choosing a light or a dark theme from the answer chooses
       * wrong. An owner with no window leaves it out.
       */
      colors?: TerminalColors;
      /**
       * A file to record the session in: what its program writes, so that its screen can be picked up by
       * the session that replaces it (`restore`) and looked back through (`rewind`). It holds everything
       * the program printed, so it is recorded only where asked, in a file only the user can read.
       */
      record?: string;
      /** Begin with the screen and history `record` already holds, and carry the recording on */
      restore?: boolean;
      /** Whether its programs may send images. For a session a window draws */
      images?: boolean;
    },
    listeners: TerminalListeners,
  ): Promise<TerminalSession>;
  /**
   * Takes up a session that is already running, by the id it was given when it started.
   *
   * **What a restarted service needs and cannot otherwise have.** A session outlives the process that opened
   * it on purpose; without this it outlives it *unreachably* — no listeners, no handle, and a fresh shell
   * started beside it for the same terminal, repeated on every restart until the app quits.
   *
   * Refuses when no session has that id, which is the ordinary case after a full app restart: every session
   * ends with the app, so every id a caller stored is stale. That refusal is how a caller tells a session
   * that survived from one that did not, so it is the signal to start a shell rather than an error to
   * report.
   */
  adopt(id: string, listeners: TerminalListeners): Promise<TerminalSession>;
  /** Every session that is running, which is how the ones a previous run of the app kept are found */
  sessions(): Promise<readonly TerminalSessionSummary[]>;
  /** Opens the recording at `recording` to be looked back through, showing its end */
  rewind(recording: string, size: { readonly cols: number; readonly rows: number }): Promise<TerminalRewind>;
  /**
   * The same service for sessions somewhere else: another machine, a container — wherever `target`'s
   * command runs. Everything a session does is the same there; what differs is that paths (`cwd`,
   * `shell`, `record`) are that machine's.
   */
  at(target: TerminalTarget): TerminalService;
}

/**
 * Somewhere a terminal can run that is not this machine, as the command that reaches it.
 *
 * The command runs the terminal broker's proxy there — `ssh host apack-terminal proxy <socket>`,
 * `docker exec -i box apack-terminal proxy <socket>` — and is given as the arguments it is, never as a
 * line for a shell to split. The broker's binary has to be on the far side; nothing here puts it there.
 */
export interface TerminalTarget {
  readonly command: readonly string[];
}
