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
 * **Attach and detach are not here yet.** This is the one session an owner opens and ends. Observing a
 * session from a second window, and a view's close detaching rather than terminating, are the host session
 * service's and arrive with it; what this fixes now is who owns the process.
 */

/** What a session's owner hears from it. Both are news: nobody asked, and neither answers a call. */
export interface TerminalListeners {
  /** Bytes the process wrote, as they arrive */
  onOutput(data: string): void;
  /** The process ended, however it ended — killed or of its own accord. Delivered once */
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
   * How many lines of scrollback this session has, which is the host's number and not the window's.
   *
   * **One number, answered by whatever owns the session.** A window's emulator holds whatever it was sent
   * while attached; the host holds this whether or not a window is drawing, and it is what a reattaching
   * window is given. Drawing more than this would be drawing lines that cannot survive a reattach — which
   * is what two independent constants produced, 10,000 in the window against 1,000 in the host, so closing
   * and reopening a window silently lost nine tenths of it.
   */
  readonly scrollback: number;
  /** Bytes the user typed */
  write(data: string): Promise<void>;
  /** The viewport changed. One size per session, because a pty has one */
  resize(cols: number, rows: number): Promise<void>;
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
  /** Ends the session and its process tree. Explicit termination, as distinct from a view closing */
  terminate(): Promise<void>;
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
}
