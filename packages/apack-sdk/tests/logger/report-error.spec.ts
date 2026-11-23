// reportError and createLogger on the test host: what a system or step reports reaches the log, the
// user and, for a step, its RunNode.
//
// Its sends carry `via` and no `from`. A report is made on behalf of whoever called `reportError`, and what it is
// told about that caller is a source (`'brain-llm'`, `'notes'`) — the same string its logger is named, and never a
// pack. So `via` names it and `from` stays the pack's alone, which is the whole of why the envelope has two fields.
import * as os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, reportError, setDebugEnabled, type LogEvent } from '../../src/logger/index.ts';
import { startTestRuntime, takeSystemErrors, testPacks, testRootEvents, testRunHistory } from '../../src/testing/index.ts';
import { RepositoryError, RepositoryErrorCode } from '../../src/repositories/repository-error.ts';
import type { Message } from '../../src/events/index.ts';
import type { EARS } from '../../src/types/entities.ts';

process.env.APACK_ENV ??= 'test';
process.env.APACK_USER_DATA_DIR ??= os.tmpdir();
startTestRuntime();


/** What reached the bus: log events, sends to surfaces through the bus, and events straight to the clients */
function capture(run: () => void): { logs: LogEvent[]; toSurfaces: Message[]; outgoing: Message[] } {
  const logs: LogEvent[] = [];
  const toSurfaces: Message[] = [];
  const outgoing: Message[] = [];
  const stop = [
    testRootEvents.onLog((e) => logs.push(e)),
    testRootEvents.onSurfaceSend((e) => toSurfaces.push(e)),
    testRootEvents.onOutgoing((e) => outgoing.push(e)),
  ];
  try {
    run();
  } finally {
    stop.forEach((unsubscribe) => unsubscribe());
  }
  return { logs, toSurfaces, outgoing };
}

afterEach(() => {
  takeSystemErrors();
  testPacks.designations.clear();
  vi.restoreAllMocks();
});

describe('reportError', () => {
  it("with step context logs the error, sends it to the surface playing the brain role and records it on the step's run node", () => {
    const printed = vi.spyOn(console, 'error').mockImplementation(() => {});
    testPacks.designations.set('brain', 'default-setup/brain');
    // The step's run node, holding what the step ran with
    const history = testRunHistory();
    const runNodeId = history.start({ kind: 'step', label: 'Step', stepNodeType: 'llm', input: { prompt: 'hello' } }).id;
    let returned: ReturnType<typeof reportError>;
    const { logs, toSurfaces, outgoing } = capture(() => {
      returned = reportError({
        error: new Error('model failed'),
        source: 'brain-llm',
        step: { phase: 'llm.execute', runNodeId, nodeId: 'Node-1' as EARS.EntityId, nodeType: 'llm', eventType: 'user.message' },
      });
    });

    const { errorId, stack } = returned!;
    expect(returned!).toMatchObject({ source: 'brain-llm', phase: 'llm.execute', runNodeId, message: 'model failed' });
    expect(logs).toEqual([expect.objectContaining({ level: 'error', source: 'step-runtime', message: 'model failed', stack })]);
    // A log event, printed once as every log event is; the flow shows it, so there's no system error
    expect(printed).toHaveBeenCalledTimes(1);
    // The surface's ref: a bare name is no surface's, and the bus would drop it. `via` is the step that reported it,
    // so a drop names the step rather than nothing; there is no pack here to put in `from`.
    expect(toSurfaces).toEqual([{ to: 'default-setup/brain', call: expect.any(String), event: { type: 'BRAIN_RUNTIME_ERROR', error: returned! }, via: 'brain-llm' }]);
    expect(outgoing).toEqual([]);
    expect(history.get(runNodeId)).toMatchObject({
      input: { prompt: 'hello' },
      result: { error: { message: 'model failed', source: 'brain-llm', phase: 'llm.execute', errorId, stack } },
    });
    expect(takeSystemErrors()).toEqual([]);
  });

  it('sends a step error to no surface when none plays the brain role, still recording it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { toSurfaces } = capture(() => reportError({
      error: new Error('model failed'),
      step: { phase: 'llm.execute', nodeId: 'Node-1' as EARS.EntityId, nodeType: 'llm', eventType: 'user.message' },
    }));
    expect(toSurfaces).toEqual([]);
  });

  it('redacts key-shaped strings a provider error quotes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reported = capture(() => {
      reportError({ error: new Error('Incorrect API key provided: sk-proj-abcdef123456'), source: 'brain-llm', step: { phase: 'llm.execute' } });
    });
    expect(reported.logs).toHaveLength(1);
    expect(JSON.stringify(reported)).not.toContain('sk-proj-abcdef123456');
  });

  it('unwraps SuppressedError chains and redacts secrets across primary and disposal failures', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let caught: unknown;
    try {
      using stack = new DisposableStack();
      stack.defer(() => { throw new Error('close failed with sk-ant-secret1234567890'); });
      throw new Error('primary failed with sk-proj-abcdef1234567890');
    } catch (err) {
      caught = err;
    }
    const { logs, outgoing } = capture(() => {
      reportError({ error: caught, source: 'packs', operation: 'install' });
    });
    expect(outgoing).toHaveLength(1);
    const message = String(outgoing[0]!.event.message);
    expect(message).toContain('primary failed with');
    expect(message).toContain('(cleanup also failed: close failed with');
    expect(message).not.toContain('An error was suppressed during disposal');
    expect(JSON.stringify({ logs, outgoing })).not.toContain('sk-proj-abcdef1234567890');
    expect(JSON.stringify({ logs, outgoing })).not.toContain('sk-ant-secret1234567890');
  });

  it('without step context logs a system error and sends it to the app to show', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('boom');
    const { logs, toSurfaces, outgoing } = capture(() => {
      expect(reportError({ error, source: 'notes', title: 'Could not save', operation: 'save' })).toBeUndefined();
    });
    const event = {
      type: 'SYSTEM_ERROR', errorId: expect.stringMatching(/^err_/), title: 'Could not save',
      message: 'boom', source: 'notes', operation: 'save', answering: undefined, entityId: undefined, severity: 'error', stack: error.stack,
      timestamp: expect.any(Number),
    };
    expect(outgoing).toEqual([{ to: 'host/application', event, via: 'notes' }]);
    expect(takeSystemErrors()).toEqual([event]);
    expect(logs).toEqual([expect.objectContaining({ level: 'error', source: 'notes', message: 'boom', stack: error.stack })]);
    expect(toSurfaces).toEqual([]);
  });

  // A report with no source still says where it came from, rather than falling back to nothing
  it('names the source it was given, or a plain default, and never a pack', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { outgoing } = capture(() => reportError({ error: new Error('boom') }));
    expect(outgoing[0]).toMatchObject({ via: 'system' });
    expect(outgoing[0]).not.toHaveProperty('from');
  });

  it("shows a user-safe message for a missing entity, and the report's own message over the error's", () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reportError({ error: new RepositoryError('Note-1 not found', RepositoryErrorCode.NOT_FOUND), source: 'notes' });
    reportError({ error: new Error('disk full'), source: 'notes', userMessage: 'Could not save the note' });
    expect(takeSystemErrors().map((e) => e.message)).toEqual(['That item no longer exists.', 'Could not save the note']);
  });

  it('redacts key-shaped strings in a system error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reported = capture(() => reportError({ error: new Error('bad key sk-proj-abcdef1234567890'), source: 'notes' }));
    expect(reported.outgoing).toHaveLength(1);
    expect(JSON.stringify(reported)).not.toContain('sk-proj-abcdef1234567890');
  });
});

describe('createLogger', () => {
  it("logs debug messages of a { debug: true } logger only while its source's toggle is on", () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createLogger('gated-source', { debug: true });

    setDebugEnabled('gated-source', false);
    expect(capture(() => { logger.debug('hidden'); logger.info('shown'); }).logs.map((e) => e.message)).toEqual(['shown']);

    setDebugEnabled('gated-source', true);
    expect(capture(() => logger.debug('visible')).logs.map((e) => e.message)).toEqual(['visible']);
  });
});
