// A log line must never cost the caller, or the event.
//
// `appendAppEventLog` runs inside `emitLog`, *before* its own `emit`, so a throw there took three things at
// once: the line, the event reaching the console printer and the logs system, and the caller that logged it. A
// BigInt was enough to do it — `reportError`'s step path hands this `redactSecrets` output, which passes one
// through untouched, and a bare `JSON.stringify` refuses it.
//
// What these cases cover is the serialising, which is the half that was broken. The other half, a write that
// fails, is `appendCappedLine`'s and is covered where it lives — a case here could not fail, which a mutation
// showed: with the appender's own swallow in place, nothing this file does can make the write throw.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LogEvent } from '@apackdev/sdk/logger';
import { rootEvents } from '../../src/transport/emitter.ts';

let logDir: string;
let previous: string | undefined;

beforeEach(() => {
  previous = process.env.APACK_LOG_DIR;
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-emitter-'));
  process.env.APACK_LOG_DIR = logDir;
});

afterEach(() => {
  if (previous === undefined) delete process.env.APACK_LOG_DIR;
  else process.env.APACK_LOG_DIR = previous;
  fs.rmSync(logDir, { recursive: true, force: true });
});

/** The lines `app-events.log` holds, or none when nothing was written */
function written(): string[] {
  const file = path.join(logDir, 'app-events.log');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8').trim();
  return text === '' ? [] : text.split('\n');
}

/** Emits `event` and returns what the listeners heard, which is the half a throw used to cost */
function emitted(event: LogEvent): LogEvent[] {
  const heard: LogEvent[] = [];
  const stop = rootEvents.onLog((seen) => heard.push(seen));
  try {
    rootEvents.emitLog(event);
  } finally {
    stop();
  }
  return heard;
}

describe('a log event holding a value JSON has no form for', () => {
  it('reaches its listeners, and is written with the value described', () => {
    const heard = emitted({ level: 'info', message: 'a row', meta: { id: 'Note-1', count: 9007199254740993n } } as LogEvent);

    expect(heard, 'the listeners are what a throw here used to cost').toHaveLength(1);
    expect(written()).toHaveLength(1);
    expect(JSON.parse(written()[0]).meta).toEqual({ id: 'Note-1', count: '9007199254740993' });
  });

  it('writes a loop with the loop cut rather than losing the line', () => {
    const meta: Record<string, unknown> = { id: 'Note-1' };
    meta.self = meta;

    const heard = emitted({ level: 'warn', message: 'a loop', meta } as LogEvent);

    expect(heard).toHaveLength(1);
    expect(JSON.parse(written()[0]).meta).toEqual({ id: 'Note-1', self: '[circular]' });
  });
});

describe('a log event that cannot be serialised at all', () => {
  /**
   * The placeholder has to still be a log line.
   *
   * The socket's last resort is a JSON-RPC frame, which is right for a client waiting on a call and nonsense in
   * a file something else parses — it replaced the timestamp, the level and the message with
   * `{"jsonrpc":"2.0",…}`. The shape belongs to the caller for that reason.
   */
  it('keeps what is plain text and names what went wrong', () => {
    const meta: Record<string, unknown> = {};
    Object.defineProperty(meta, 'boom', { enumerable: true, get() { throw new Error('bang'); } });

    const heard = emitted({ level: 'error', message: 'a hostile field', source: 'memos', meta } as LogEvent);

    expect(heard, 'the listeners still hear it').toHaveLength(1);
    const line = JSON.parse(written()[0]);
    expect(line, 'and the line is a log line').toMatchObject({ level: 'error', source: 'memos', message: 'a hostile field' });
    expect(typeof line.timestamp).toBe('string');
    expect(line.unserialisable, 'saying why the meta is missing').toContain('bang');
    expect(line, 'and carries no frame').not.toHaveProperty('jsonrpc');
  });
});

describe('an ordinary log event', () => {
  it('is written as one JSON line carrying when and which run', () => {
    emitted({ level: 'info', message: 'plain', source: 'memos' } as LogEvent);

    const line = JSON.parse(written()[0]);
    expect(line).toMatchObject({ level: 'info', message: 'plain', source: 'memos' });
    expect(typeof line.timestamp, 'so a reader can order them').toBe('string');
  });
});
