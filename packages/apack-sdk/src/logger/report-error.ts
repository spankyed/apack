import { _rootEvents } from '../runtime/root-events.ts';
import { createSends } from '../events/index.ts';
import { getDesignated, hasDesignation } from '../designations/index.ts';
// Import directly — not from '../utils' barrel which pulls in Node-only modules (fs, child_process)
import { randomId } from '../utils/random-id.ts';
import { RepositoryError, RepositoryErrorCode } from '../repositories/repository-error.ts';
import { redactSecrets, redactSecretText } from '../utils/redact.ts';
import { boundHost } from '../runtime/host-runtime.ts';
import type { RunNodeId } from '../services/run-history.ts';
import type { StepRuntimeError } from '../steps/types.ts';
import { createLogger } from './logger.ts';

const logger = createLogger('step-runtime');

/** Where in a flow run an error happened: the step's phase and the RunNode, node, flow and event it belongs to */
export type StepErrorContext = Omit<StepRuntimeError, 'errorId' | 'message' | 'stack' | 'timestamp' | 'source'>;

/** How loudly a system error is shown: an error page, a toast, or neither */
export type SystemErrorSeverity = 'diagnostic' | 'error' | 'fatal';

export interface ReportErrorInput {
  error: unknown;
  /** What reported it: a system or step id (`notes`, `brain-llm`) */
  source?: string;
  title?: string;
  /**
   * The verb that was attempted: `setPackEnabled`, `broadcast`, `tell`. A reader filters on it
   * to pick out one kind of report from a list of them, so it names **one** fact and keeps naming it —
   * `undeclared-incoming.spec.ts` separates the bus's inward reports from its outward ones this way, and the
   * E2E fixture collects the outward ones to fail a test on a dropped send.
   *
   * That is why `answering` below is its own field and not a third value here. Folding it in was tried on
   * 2026-10-07 and shipped a regression: the fixture's filter went on naming one value while the bus started
   * sending two, so dropped answers stopped failing any Playwright test and nothing noticed.
   */
  operation?: string;
  /**
   * That the thing being reported was an **answer** rather than something a person asked for, from
   * `Message.answering`. A separate axis from `operation`, which says which verb: a report can be an outward
   * send *and* an answer, and a reader filtering for either must not lose the other.
   *
   * `true` or absent, never `false`, like the envelope field it comes from.
   */
  answering?: true;
  entityId?: string;
  /**
   * How loudly the app shows it. `fatal` replaces the window with an error page, `error` raises a
   * toast, and `diagnostic` does neither: it is logged and recorded like the others, and reaches the
   * Logs surface and `takeSystemErrors()` the same way, but it does not interrupt.
   *
   * `diagnostic` is for a report whose reader is whoever is building the app or a pack — a send to a
   * surface nobody declares, say. The person using the app cannot act on it, and a toast reading
   * "Something went wrong" over a correct action of theirs costs more than it tells anyone.
   */
  severity?: SystemErrorSeverity;
  /** Shown to the user instead of the error's own message */
  userMessage?: string;
  /** The step run the error came from: the error is recorded on its RunNode and shown in the flow instead of as a toast */
  step?: StepErrorContext;
}

/** A system error's report, without a step */
export type ReportSystemErrorInput = Omit<ReportErrorInput, 'step'>;

/** What the app shows for a system error: sent to the `host/application` surface */
export type SystemErrorEvent = {
  type: 'SYSTEM_ERROR';
  errorId: string;
  message: string;
  title?: string;
  source?: string;
  operation?: string;
  /** That this reports an answer rather than a command — a separate axis from `operation`, which says the verb */
  answering?: true;
  entityId?: string;
  severity: SystemErrorSeverity;
  stack?: string;
  timestamp: number;
};

/**
 * Reports an error: logs it and shows it to the user. Without `step` the app shows it as a system error.
 * With `step` it's a flow step's error: it's also recorded on the step's RunNode, sent to the surface playing the
 * `brain` role (`BRAIN_RUNTIME_ERROR`) and returned.
 */
export function reportError(input: ReportErrorInput & { step: StepErrorContext }): StepRuntimeError;
export function reportError(input: ReportErrorInput): StepRuntimeError | undefined;
export function reportError({ step, ...input }: ReportErrorInput): StepRuntimeError | undefined {
  if (!step) {
    reportSystemError(input);
    return undefined;
  }
  return reportStepError(input, step);
}

/** The error's name, message and stack, with key-shaped strings redacted (provider errors can quote the key) */
function normalizeError(error: unknown): { message: string; stack?: string; name?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSecretText(error.message || error.toString()),
      stack: error.stack && redactSecretText(error.stack),
    };
  }
  if (typeof error === 'string') return { message: redactSecretText(error) };
  try {
    return { message: redactSecretText(JSON.stringify(error)) };
  } catch {
    return { message: redactSecretText(String(error)) };
  }
}

function userSafeMessage(error: unknown, fallback: string): string {
  if (error instanceof RepositoryError && error.code === RepositoryErrorCode.NOT_FOUND) return 'That item no longer exists.';
  return fallback;
}

/** Logs a system error and sends it to the app, which shows it */
function reportSystemError(input: ReportSystemErrorInput): void {
  const normalized = normalizeError(input.error);
  const message = input.userMessage ?? userSafeMessage(input.error, normalized.message);
  const severity = input.severity ?? 'error';
  const event: SystemErrorEvent = {
    type: 'SYSTEM_ERROR',
    errorId: randomId({ prefix: 'err_', counterSafe: true }),
    title: input.title,
    message,
    source: input.source,
    operation: input.operation,
    answering: input.answering,
    entityId: input.entityId,
    severity,
    stack: normalized.stack,
    timestamp: Date.now(),
  };
  _rootEvents.emitLog({
    level: 'error',
    source: input.source ?? 'system',
    message,
    stack: normalized.stack,
    meta: { errorId: event.errorId, operation: input.operation, ...(input.answering ? { answering: input.answering } : {}), entityId: input.entityId, severity, error: normalized },
  });
  // `via`, not `from`: a report is sent on behalf of whoever called `reportError`, and that is a source
  // (`'bus'`, `'action:Summarise'`) rather than a pack — the one thing this function is never told.
  _rootEvents.emitOutgoing({ to: 'host/application', event, via: input.source ?? 'system' });
}

function reportStepError(input: ReportSystemErrorInput, step: StepErrorContext): StepRuntimeError {
  const err = input.error instanceof Error ? input.error : new Error(String(input.error));
  const source = input.source ?? 'step-runtime';
  const runtimeError: StepRuntimeError = {
    ...step,
    source,
    errorId: randomId(),
    // Provider errors can quote part of the key they were given
    message: redactSecretText(err.message || String(input.error)),
    stack: err.stack && redactSecretText(err.stack),
    timestamp: Date.now(),
  };

  // Recorded in the log only; the flow shows it
  _rootEvents.emitLog({
    level: 'error',
    source: 'step-runtime',
    message: runtimeError.message,
    stack: runtimeError.stack,
    meta: { ...runtimeError, error: redactSecrets(input.error) },
  });

  if (runtimeError.runNodeId) {
    try {
      boundHost().services.runHistory.update(runtimeError.runNodeId as RunNodeId, { result: {
        error: {
          message: runtimeError.message,
          source: runtimeError.source,
          phase: runtimeError.phase,
          errorId: runtimeError.errorId,
          stack: runtimeError.stack,
        },
      } });
    } catch (err) {
      logger.warn('Failed to record the runtime error in the run history', { runNodeId: runtimeError.runNodeId, error: err });
    }
  }

  // The flow shows it in the surface playing the brain role, if any does — sent as the step that reported it, so a
  // drop names the step rather than nothing
  if (hasDesignation('brain')) createSends({ via: source }).broadcast(getDesignated('brain'), { type: 'BRAIN_RUNTIME_ERROR', error: runtimeError });
  return runtimeError;
}
