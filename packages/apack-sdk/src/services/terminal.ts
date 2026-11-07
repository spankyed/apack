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
  onExit(code: number | null): void;
}

/** One session, as its owner holds it */
export interface TerminalSession {
  /** The host's id for the session; a pack never invents one */
  readonly id: string;
  /** The process id, for a diagnostic. Not a handle: nothing addresses a session by it */
  readonly pid: number;
  /** Bytes the user typed */
  write(data: string): Promise<void>;
  /** The viewport changed. One size per session, because a pty has one */
  resize(cols: number, rows: number): Promise<void>;
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
      cwd?: string;
    },
    listeners: TerminalListeners,
  ): Promise<TerminalSession>;
}
