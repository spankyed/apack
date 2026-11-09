/**
 * The program the app installs into the Claude CLI as a plugin.
 *
 * **This runs in the CLI's runtime, not the app's.** It may import nothing but the type declarations beside
 * it: at runtime it is one bundled module written into a temporary plugin directory, loaded by a CLI that
 * knows nothing about this pack. The only thing interpolated into it is data — its socket paths and tokens,
 * which arrive as `APACK_NATIVE_CONFIG` from the prelude `createClaudeTerminalPlugin` writes above the
 * bundle.
 *
 * It was a template string, which meant neither the typechecker nor the linter read it and the only way to
 * run it was to launch the CLI. It is a module now, so `tests/features/code/be/services/claude-code/` drives
 * it with a fake `$` and the fencing, the lease and the backoff are unit-checked.
 *
 * **What the program owns:** one session's identity, and the generation fencing that makes a session
 * handoff discard everything the previous one had in flight.
 */
import type {
  ClaudeAppendEvent,
  ClaudeAppendResult,
  ClaudeClassicEvent,
  ClaudeHookRegistrar,
  ClaudePluginApi,
  ClaudePluginSettings,
  ClaudePluginStatusLine,
  ClaudePluginTimer,
  ClaudePromptSubmitResult,
  ClaudeTurnEvent,
} from './claude-plugin-api.ts';

/** Where the app listens, and what proves a request came from the app's own plugin. */
export interface ApackNativePluginConfig {
  /** The owning app's socket: every route but the two background ones. */
  socketPath: string;
  token: string;
  /**
   * The background observer's own channel.
   *
   * A session the app no longer owns keeps reporting to this one, so a terminal the user detached still has
   * a status line. `parentSessionId` is the session the app launched: a *different* session reaching a dead
   * parent socket is a reload of the child, which registers itself here instead.
   */
  background: { parentSessionId: string; socketPath: string; token: string };
}

/** The error names the recovery below routes on. */
const BROKER_UNAVAILABLE = 'ApackBrokerUnavailable';
const BROKER_REFUSED = 'ApackBrokerRefused';
const LEASE_EXPIRED = 'ApackBackgroundLeaseExpired';

/** The two routes that belong to the background observer rather than the owning app. */
const BACKGROUND_ROUTES = ['/background-register', '/background-status'];

/**
 * The routes this program *notifies* on: what the app learns sooner this way than from what it already
 * reads, and never the only way it can learn it.
 *
 * **Each one's failure is counted and carried to the app on the next exchange** (`dropped`), because a
 * swallowed failure here is an error channel nothing reads — and that is a defect this integration has paid
 * for once already. What makes a count the right answer rather than a refusal is that every one of them is
 * already healed by something the app does anyway:
 *
 * - `transcript` — the tick re-sends the path on every pass while the session holds one.
 * - `append` — the app reads the same row out of the journal file this path names.
 * - `turn` — the next exchange reports the session's state, busy flag included.
 * - `submission` — the app polls the prompt's outcome and times the submission out with a reason.
 * - `ui-ready` — startup readiness; the first exchange reports the same session.
 *
 * So a drop costs latency, and the count is what says how much of it happened. It is not a payload: the
 * app's lifecycle trace carries the route and the number, which is why both are closed sets.
 */
export const NATIVE_NOTIFICATION_ROUTES = ['transcript', 'append', 'turn', 'submission', 'ui-ready'] as const;

export type NativeNotificationRoute = (typeof NATIVE_NOTIFICATION_ROUTES)[number];

/**
 * The clock the program wakes on, and the rate it reports at until the app says otherwise.
 *
 * **Waking is not reporting.** The tick is the finest cadence available; what it does on each wake is
 * decided by the app's last answer (`reportEveryMs`) and by the hooks, which ask for a pass immediately
 * because a turn boundary or a render is news. An app that is not reading this session's state — the native
 * UI reports its own, and then nothing reads the plugin's — answers `0`, and the program then reports only
 * when a hook wakes it, instead of four times a second for the rest of the session.
 */
const TICK_MS = 250;

/** The widest cadence the app may ask for; beyond this the answer is treated as absent. */
const REPORT_CEILING_MS = 60000;

/** A leased child reports a quarter as often: its status line is the only reader. */
const BACKGROUND_TICKS_PER_REPORT = 4;

/** The backoff a lost broker is retried on, and its ceiling. */
const RETRY_FLOOR_MS = 1000;
const RETRY_CEILING_MS = 5000;

/**
 * An error carrying a name the recovery can read.
 *
 * `defineProperty` rather than `error.name = …`: the CLI may harden its runtime, and a frozen
 * `Error.prototype` makes the assignment fail — silently in a sloppy-mode caller — which would leave every
 * failure here indistinguishable from every other and the lease unrecoverable.
 * `tests/.../terminal-plugin.spec.ts` runs the built program in a realm whose `Error.prototype` is frozen,
 * which is what fails if this becomes an assignment.
 */
function namedError(name: string, message: string): Error {
  const error = Error(message);
  Object.defineProperty(error, 'name', { value: name });
  return error;
}

/** The name an error arrived under, for a value that may not be an `Error` at all. */
function errorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : undefined;
}

/** A status-line helper's command, or null when settings hold something that is not one. */
function helperCommand(helper: ClaudePluginStatusLine | null | undefined): string | null {
  return helper?.type === 'command' && typeof helper.command === 'string' ? helper.command : null;
}

export function createApackNativePlugin(config: ApackNativePluginConfig) {
  /**
   * **The fence.** Every await in this program is a point where the session can be handed to another, and
   * what was in flight across it belongs to the session that started it. Each start takes a generation, and
   * anything that comes back under a stale one is dropped rather than applied.
   */
  let generation = 0;
  let producerSessionId: string | undefined;
  let timer: ClaudePluginTimer | undefined;
  let retired = false;
  let started = false;
  let inFlight = false;
  /** The app's command this program is filling, until `prompt.submit` reports what the CLI did with it. */
  let submission: { id: string } | undefined;
  /** Held while this session reports to the background observer rather than to the app. */
  let backgroundLease: string | undefined;
  let backgroundPid: number | undefined;
  let backgroundSequence = 0;
  let backgroundTick = 0;
  let backgroundAttempted = false;
  let reconnecting = false;
  let retryAfter = 0;
  let retryDelay = RETRY_FLOOR_MS;
  /** What the app last asked for, and when the next report is due. `Infinity` is "when a hook says". */
  let reportEveryMs: number = TICK_MS;
  let reportDueAt = 0;
  /** The prefix this program installed, and the user's own that it replaced. */
  let formatterPrefix: string | undefined;
  let originalFormatterPrefix: string | null | undefined;
  /** Each session's transcript path, as the classic hook reports it. */
  const paths: Record<string, string> = {};
  /** Notifications that did not arrive, per route, until an exchange carries the count to the app. */
  const dropped: Partial<Record<NativeNotificationRoute, number>> = {};

  async function send($: ClaudePluginApi, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const sentGeneration = generation;
    const sessionId = await $.session.id();
    if (sentGeneration !== generation) throw Error('Owned session retired');
    const childRoute = BACKGROUND_ROUTES.includes(path);
    // A leased child has nothing to say to the app: it reports to the observer and nowhere else.
    if (backgroundLease && !childRoute) return {};
    let response;
    try {
      response = await $.http.fetch('http://apack' + path, {
        method: 'POST',
        socketPath: childRoute ? config.background.socketPath : config.socketPath,
        headers: {
          'x-apack-native-token': childRoute ? config.background.token : config.token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ sessionId, ...body }),
      });
    } catch {
      throw namedError(BROKER_UNAVAILABLE, 'Owned terminal broker unavailable');
    }
    if (sentGeneration !== generation) throw Error('Owned session retired');
    if (!response.ok) {
      throw namedError(childRoute && response.status === 409 ? LEASE_EXPIRED : BROKER_REFUSED, 'Owned terminal broker refused');
    }
    return JSON.parse(response.text) as Record<string, unknown>;
  }

  /**
   * Tell the app something it will otherwise learn later, and count it if that fails.
   *
   * The route list above says what heals each one. A failure the *tick* meets is different — it drives the
   * lease recovery — so only these five are counted rather than thrown.
   */
  async function notify($: ClaudePluginApi, route: NativeNotificationRoute, body: Record<string, unknown>) {
    try {
      await send($, '/' + route, body);
    } catch {
      dropped[route] = (dropped[route] ?? 0) + 1;
    }
  }

  /** Everything a session handoff drops, so the next session starts from nothing the previous one held. */
  function retireForNewSession() {
    generation++;
    timer?.cancel();
    started = false;
    retired = false;
    inFlight = false;
    submission = undefined;
    backgroundLease = undefined;
    backgroundSequence = 0;
    backgroundTick = 0;
    backgroundAttempted = false;
    reportEveryMs = TICK_MS;
    reportDueAt = 0;
    // A child that already learned its own pid reconnects rather than asking for it again.
    reconnecting = Number.isSafeInteger(backgroundPid) && (backgroundPid as number) > 1;
    retryAfter = 0;
    retryDelay = RETRY_FLOOR_MS;
  }

  /** The settings the status-line helpers come from, which policy can take over. */
  async function readHelperSettings($: ClaudePluginApi) {
    const settings = await $.settings.read();
    const policy = await $.settings.read({ source: 'policy' });
    const helpers: ClaudePluginSettings =
      policy.allowManagedHooksOnly || (settings.disableAllHooks && !policy.disableAllHooks) ? policy : settings;
    return { settings, policy, helpers, main: policy.disableAllHooks ? null : helpers.statusLine };
  }

  /** What the app is told about the session on every tick. */
  async function readState($: ClaudePluginApi) {
    const agents = (await $.agent.list()).map(agent => ({ id: agent.id, type: agent.type, status: agent.status }));
    const usage = await $.session.usage();
    const metadata = {
      cwd: await $.session.cwd(),
      model: await $.session.model(),
      turns: await $.session.turns(),
      startedAt: usage.startedAt,
      ...(usage.cost ? { totalCostUsd: usage.cost.usd } : {}),
    };
    return { agents, usage, metadata };
  }

  /** A leased child's report to the background observer, and the formatter prefix it answers with. */
  async function reportToObserver(
    $: ClaudePluginApi,
    ownGeneration: number,
    state: Awaited<ReturnType<typeof readState>>,
  ) {
    if (backgroundTick++ % BACKGROUND_TICKS_PER_REPORT !== 0) return;
    const { settings, policy, helpers, main } = await readHelperSettings($);
    const currentPrefix = (await $.env.get('CLAUDE_CODE_SHELL_PREFIX')) ?? null;
    if (ownGeneration !== generation) return;
    // A prefix this program did not install is the user's, and is what it restores on the way out.
    if (currentPrefix !== formatterPrefix) originalFormatterPrefix = currentPrefix;
    const result = await send($, '/background-status', {
      pid: backgroundPid,
      token: backgroundLease,
      sequence: ++backgroundSequence,
      metadata: state.metadata,
      usage: state.usage,
      helpers: {
        agents: state.agents,
        command: policy.disableAllHooks ? null : helperCommand(helpers.subagentStatusLine),
        policyKey: JSON.stringify([
          policy.allowManagedHooksOnly === true,
          policy.disableAllHooks === true,
          settings.disableAllHooks === true,
        ]),
      },
      formatter: {
        command: helperCommand(main),
        shellPrefix: originalFormatterPrefix ?? null,
        policy: JSON.stringify({
          allowManagedHooksOnly: policy.allowManagedHooksOnly === true,
          disableAllHooks: policy.disableAllHooks === true,
          hooksDisabled: settings.disableAllHooks === true,
        }),
      },
    });
    if (Object.prototype.hasOwnProperty.call(result, 'originalPrefix')) {
      originalFormatterPrefix = result.originalPrefix as string | null;
    }
    if (Object.prototype.hasOwnProperty.call(result, 'shellPrefix') && result.shellPrefix !== currentPrefix) {
      const applied = await $.env.set('CLAUDE_CODE_SHELL_PREFIX', (result.shellPrefix as string | undefined) ?? undefined);
      if (!applied?.deny) formatterPrefix = result.shellPrefix as string | undefined;
    }
  }

  /**
   * Learn this process's own pid, which is what the observer leases against.
   *
   * **The pid is an identity anchor, not a label**: the observer resolves it to a background job's identity
   * and revalidates that on every write, so a replaced process cannot keep reporting as the one that
   * registered. A token alone would be replayable by exactly that process.
   *
   * **Why the app does not supply it.** A session's `pid` is a diagnostic in the terminal service's own
   * words — `null` for a session it took up again after a restart, and explicitly not a handle — so a pid
   * interpolated at spawn time would be absent in the case this path exists for. Asking the runtime is the
   * only answer that is always about the process actually running the program.
   *
   * **This is the one POSIX-only line in the program**, and what replaces it is upstream: an accessor for
   * the CLI's own pid, or peer credentials on the socket, which Node does not expose. Until one of those
   * exists, a Windows host is refused by name where the terminal is prepared rather than approximated here.
   */
  async function registerWithObserver($: ClaudePluginApi) {
    const host = await $.process.run(['/bin/sh', '-c', 'printf "%s" "$PPID"'], { timeoutMs: 3000 });
    if (host.exitCode !== 0) throw Error('Original background identity helper refused');
    backgroundPid = Number(host.stdout.trim());
    const registered = await send($, '/background-register', { pid: backgroundPid });
    backgroundLease = registered.token as string;
  }

  /** Fill the app's command into the prompt, and report whether it took. */
  async function fillPrompt($: ClaudePluginApi, command: Record<string, unknown>) {
    submission = { id: command.id as string };
    let filled = command.prepared === true;
    try {
      if (!filled) {
        const before = await $.prompt.read();
        if (!before.text) {
          const result = await $.prompt.fill({ text: command.text as string, mode: 'replace' });
          filled = result?.isFilled === true && (await $.prompt.read()).text === command.text;
        }
      }
    } catch {
      // A prompt the CLI would not let this program write is reported unfilled below, not thrown: the app
      // keeps the draft and the user keeps the session.
    }
    if (!filled) submission = undefined;
    await send($, '/result', { id: command.id, filled });
  }

  /** One pass: report state, take whatever work came back with the answer. */
  async function exchange($: ClaudePluginApi, ownGeneration: number) {
    if (reconnecting) {
      const registered = await send($, '/background-register', { pid: backgroundPid });
      backgroundLease = registered.token as string;
      backgroundSequence = 0;
      backgroundTick = 0;
      reconnecting = false;
      retryDelay = RETRY_FLOOR_MS;
      return;
    }
    const sessionId = await $.session.id();
    const state = await readState($);
    if (ownGeneration !== generation) return;
    if (backgroundLease) return reportToObserver($, ownGeneration, state);

    const { settings, policy, helpers, main } = await readHelperSettings($);
    const sub = policy.disableAllHooks ? null : helpers.subagentStatusLine;
    const shellPrefix = (await $.env.get('CLAUDE_CODE_SHELL_PREFIX')) ?? null;
    // Reported by value, and taken off the counters only once the app has them: a notification that fails
    // while this exchange is in flight is counted for the next one rather than lost to the subtraction.
    const reported = Object.keys(dropped).length ? { ...dropped } : undefined;
    let command: Record<string, unknown>;
    try {
      command = await send($, '/poll', {
        agents: state.agents,
        metadata: state.metadata,
        statusCommand: helperCommand(main),
        subagentCommand: helperCommand(sub),
        shellPrefix,
        policy: {
          allowManagedHooksOnly: policy.allowManagedHooksOnly === true,
          disableAllHooks: policy.disableAllHooks === true,
        },
        hooksDisabled: settings.disableAllHooks === true,
        ...(reported ? { dropped: reported } : {}),
      });
      if (reported) settleReported(reported);
      acceptCadence(command.reportEveryMs);
    } catch (error) {
      // A session that is not the one the app launched, reaching an app that is gone, is a detached child:
      // it registers with the observer rather than retiring.
      if (errorName(error) === BROKER_UNAVAILABLE && sessionId !== config.background.parentSessionId) {
        command = { background: true };
      } else throw error;
    }
    if (command.background === true) {
      if (backgroundAttempted) return;
      backgroundAttempted = true;
      return registerWithObserver($);
    }
    if (paths[sessionId]) await send($, '/transcript', { sessionId, path: paths[sessionId] });
    if (!command.id) return;
    return fillPrompt($, command);
  }

  /**
   * Take the app's requested cadence, which is the only thing that changes how often this reports.
   *
   * An answer that is not a number leaves the cadence alone, so an older app — or a route that does not
   * carry one — keeps the tick it had.
   */
  function acceptCadence(value: unknown) {
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > REPORT_CEILING_MS) return;
    reportEveryMs = value as number;
    reportDueAt = reportEveryMs === 0 ? Infinity : Date.now() + reportEveryMs;
  }

  /** A hook has news, so the next tick reports whatever the cadence was. */
  function reportSoon() {
    reportDueAt = 0;
  }

  /** Take a delivered report off the counters, leaving whatever arrived while it was in flight. */
  function settleReported(reported: Partial<Record<NativeNotificationRoute, number>>) {
    for (const route of Object.keys(reported) as NativeNotificationRoute[]) {
      const left = (dropped[route] ?? 0) - (reported[route] ?? 0);
      if (left > 0) dropped[route] = left;
      else delete dropped[route];
    }
  }

  /** What a failed pass does: recover the lease, or retire this program for good. */
  async function recover($: ClaudePluginApi, ownGeneration: number, error: unknown) {
    if (ownGeneration !== generation) return;
    const name = errorName(error);
    if (!backgroundLease && !backgroundAttempted && !reconnecting && name !== BROKER_UNAVAILABLE) return;
    const recoverable =
      (backgroundLease || backgroundAttempted || reconnecting) &&
      Number.isSafeInteger(backgroundPid) &&
      (backgroundPid as number) > 1 &&
      (name === BROKER_UNAVAILABLE || name === LEASE_EXPIRED);
    if (recoverable) {
      backgroundLease = undefined;
      backgroundAttempted = false;
      reconnecting = true;
      retryAfter = Date.now() + retryDelay;
      retryDelay = Math.min(RETRY_CEILING_MS, retryDelay * 2);
    } else {
      retired = true;
      timer?.cancel();
    }
    // The user's prefix goes back while this program is not the one serving it.
    if ((recoverable || backgroundLease) && formatterPrefix !== undefined) {
      try {
        const current = (await $.env.get('CLAUDE_CODE_SHELL_PREFIX')) ?? null;
        if (ownGeneration === generation && current === formatterPrefix) {
          await $.env.set('CLAUDE_CODE_SHELL_PREFIX', originalFormatterPrefix ?? undefined);
        }
      } catch {
        // A runtime that will not answer about its own environment cannot be made to restore it.
      }
    }
  }

  /**
   * Bind this program to whatever session is current, once.
   *
   * Every hook calls it, because any of them may be the first thing that runs after a handoff — and the
   * session's identity is only knowable by asking.
   */
  async function begin($: ClaudePluginApi) {
    reportSoon();
    const requestedGeneration = generation;
    const currentSession = await $.session.id();
    if (requestedGeneration !== generation) return;
    if (producerSessionId !== undefined && producerSessionId !== currentSession) retireForNewSession();
    if (started || retired) return;
    producerSessionId = currentSession;
    const ownGeneration = ++generation;
    started = true;
    timer = $.clock.every(TICK_MS, () => {
      if (ownGeneration !== generation || retired || inFlight || Date.now() < retryAfter) return;
      // A leased child reports to the observer, which is reading it: its cadence is its own (every fourth
      // tick), and the app's answer has nothing to say about it.
      if (!backgroundLease && !reconnecting && Date.now() < reportDueAt) return;
      inFlight = true;
      void exchange($, ownGeneration)
        .catch(error => recover($, ownGeneration, error))
        .finally(() => {
          if (ownGeneration === generation) inFlight = false;
        });
    });
  }

  function register(on: ClaudeHookRegistrar) {
    on('classic.*', async ($, event: ClaudeClassicEvent, next) => {
      const result = await next(event);
      if (event.transcript_path && event.session_id && event.transcript_path.endsWith('/' + event.session_id + '.jsonl')) {
        paths[event.session_id] = event.transcript_path;
        await notify($, 'transcript', { sessionId: event.session_id, path: event.transcript_path });
      }
      return result;
    });
    on('session.append', async ($, event: ClaudeAppendEvent, next) => {
      const sessionId = await $.session.id();
      const result: ClaudeAppendResult = await next(event);
      if (!event.agentId && result.message && result.uuid) {
        await notify($, 'append', {
          sessionId,
          uuid: result.uuid,
          message: result.message,
          door: event.door,
          origin: event.origin,
          ...(submission && event.door === 'prompt' ? { submissionId: submission.id } : {}),
        });
      }
      return result;
    });
    on('prompt.submit', async ($, event, next) => {
      const own = submission;
      try {
        const result: ClaudePromptSubmitResult = await next(event);
        if (own) {
          await notify($, 'submission', {
            id: own.id,
            ...(typeof result.drop === 'string' ? { drop: result.drop } : { accepted: true }),
          });
        }
        return result;
      } finally {
        if (submission === own) submission = undefined;
      }
    });
    on('session.start', async ($, event, next) => {
      await notify($, 'ui-ready', {});
      await begin($);
      return next(event);
    });
    on('ui.render', { component: 'SessionMode' }, async ($, event, next) => {
      await begin($);
      return next(event);
    });
    on('turn.start', async ($, event: ClaudeTurnEvent, next) => {
      if (!event.agentId) {
        await begin($);
        await notify($, 'turn', { running: true });
      }
      return next(event);
    });
    on('turn.complete', async ($, event: ClaudeTurnEvent, next) => {
      const result = await next(event);
      if (!event.agentId) {
        await begin($);
        await notify($, 'turn', { running: false, turnId: event.turnId, reason: event.reason });
      }
      return result;
    });
  }

  return { register };
}
