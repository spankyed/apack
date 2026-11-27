/**
 * Browser-safe `@apackdev/link` wire envelope and diagnostic cause helpers shared by `@app/server`,
 * `@app/renderer`, and `@apackdev/testing`.
 *
 * Carries `Message` routing metadata (`from`, `via`, `sender`, `call`, `answering`) inside `@apackdev/link`
 * frames without ever accepting `client` or settings credentials from the wire, and encodes ephemeral
 * `PerformanceCarrier` diagnostic context into `@apackdev/link`'s `Sending.cause` slot (max 1024 B).
 */
import type { Message } from '@apackdev/sdk/events';
import type { PerformanceCarrier } from '@apackdev/sdk/runtime';

export const BUS_LINK_TARGET = 'host/bus';
export const BUS_SEND_ASK = 'SEND';
export const BUS_CLAIM_ASK = 'CLAIM';
export const LINK_CLAIM_CONFLICT = 'CONFLICT';

const MAX_CAUSE_BYTES = 1024;
const MAX_DIAGNOSTIC_FIELD_LEN = 512;
const utf8Encoder = new TextEncoder();

export interface BusWireEnvelope {
  readonly event: { readonly type: string; readonly [key: string]: unknown };
  readonly from?: string;
  readonly via?: string;
  readonly sender?: string;
  readonly call?: string;
  readonly answering?: string;
}

export interface BusSendPayload extends BusWireEnvelope {
  readonly to: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Strips host-owned fields (`client`, `diagnostics`) and builds a clean wire envelope for `Message`.
 */
export function encodeBusEnvelope(
  message: Pick<Message, 'event' | 'from' | 'via' | 'sender' | 'call' | 'answering'>,
): BusWireEnvelope {
  return {
    event: message.event,
    ...(message.from ? { from: message.from } : {}),
    ...(message.via ? { via: message.via } : {}),
    ...(message.sender ? { sender: message.sender } : {}),
    ...(message.call ? { call: message.call } : {}),
    ...(message.answering ? { answering: message.answering } : {}),
  };
}

/**
 * Builds the validated payload for `ask(BUS_LINK_TARGET, BUS_SEND_ASK, payload)`.
 */
export function encodeBusSendPayload(
  message: Pick<Message, 'to' | 'event' | 'from' | 'via' | 'sender' | 'call' | 'answering'>,
): BusSendPayload {
  return {
    to: message.to,
    ...encodeBusEnvelope(message),
  };
}

/**
 * Decodes an incoming `tell(to, payload, how)` or `ask(BUS_LINK_TARGET, BUS_SEND_ASK, payload)` payload
 * into a strict `Message` with `client` always omitted (the server stamps `client` from the authenticated session).
 *
 * Accepts either a full `BusWireEnvelope` (`{ event: { type }, ... }`) or a raw event object (`{ type, ... }`).
 */
export function decodeBusEnvelope(
  to: string,
  payload: unknown,
  diagnostics?: PerformanceCarrier,
): Message | undefined {
  if (!nonEmptyString(to) || !isPlainRecord(payload)) return undefined;

  if (isPlainRecord(payload.event) && nonEmptyString(payload.event.type)) {
    const from = nonEmptyString(payload.from);
    const via = nonEmptyString(payload.via);
    const sender = nonEmptyString(payload.sender);
    const call = nonEmptyString(payload.call);
    const answering = nonEmptyString(payload.answering);
    return {
      to,
      event: payload.event as Message['event'],
      ...(from ? { from } : {}),
      ...(via ? { via } : {}),
      ...(sender ? { sender } : {}),
      ...(call ? { call } : {}),
      ...(answering ? { answering } : {}),
      ...(diagnostics ? { diagnostics } : {}),
    };
  }

  if (nonEmptyString(payload.type)) {
    return {
      to,
      event: payload as Message['event'],
      ...(diagnostics ? { diagnostics } : {}),
    };
  }

  return undefined;
}

/**
 * Decodes the input of `ask(BUS_LINK_TARGET, BUS_SEND_ASK, payload)` into a strict `Message`.
 */
export function decodeBusSendPayload(
  payload: unknown,
  diagnostics?: PerformanceCarrier,
): Message | undefined {
  if (!isPlainRecord(payload)) return undefined;
  const to = nonEmptyString(payload.to);
  if (!to) return undefined;
  return decodeBusEnvelope(to, payload, diagnostics);
}

function fitsCauseLimit(encoded: string): boolean {
  if (encoded.length > MAX_CAUSE_BYTES) return false;
  const wire = JSON.stringify(encoded);
  if (wire.length > MAX_CAUSE_BYTES) return false;
  return utf8Encoder.encode(wire).byteLength <= MAX_CAUSE_BYTES;
}

/**
 * Encodes an ephemeral `PerformanceCarrier` into a bounded `@apackdev/link` `Sending.cause` string.
 * Bounds the outer JSON-escaped UTF-8 wire representation (`JSON.stringify(cause)`) to `<= 1024` bytes,
 * falling back to `{ traceparent }` alone when adding `tracestate` would exceed the limit, or `undefined`
 * if even `{ traceparent }` exceeds the limit.
 */
export function encodeDiagnosticCause(carrier?: PerformanceCarrier): string | undefined {
  if (!carrier) return undefined;
  const traceparent = typeof carrier.traceparent === 'string' ? carrier.traceparent : undefined;
  const tracestate = typeof carrier.tracestate === 'string' ? carrier.tracestate : undefined;
  if (!traceparent && !tracestate) return undefined;
  const encoded = JSON.stringify({
    ...(traceparent !== undefined ? { traceparent } : {}),
    ...(tracestate !== undefined ? { tracestate } : {}),
  });
  if (fitsCauseLimit(encoded)) return encoded;
  if (traceparent !== undefined && tracestate !== undefined) {
    const traceparentOnly = JSON.stringify({ traceparent });
    if (fitsCauseLimit(traceparentOnly)) return traceparentOnly;
  }
  return undefined;
}

/** Returns `{ cause }` for `@apackdev/link`'s `Sending` parameter when a carrier is active, else `undefined`. */
export function encodeDiagnosticSending(carrier?: PerformanceCarrier): { readonly cause: string } | undefined {
  const cause = encodeDiagnosticCause(carrier);
  return cause === undefined ? undefined : { cause };
}

/**
 * Decodes `@apackdev/link`'s `Sending.cause` string back into a `PerformanceCarrier`.
 *
 * Invalid or malformed causes collapse to `{ traceparent: '' }` without rejecting application traffic,
 * preserving recording loss telemetry without failing sends or view subscriptions.
 */
export function decodeDiagnosticCause(cause?: string): PerformanceCarrier | undefined {
  if (cause === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cause);
  } catch {
    return { traceparent: '' };
  }
  if (!isPlainRecord(parsed)) return { traceparent: '' };

  const traceparent = parsed.traceparent;
  const tracestate = parsed.tracestate;
  if (traceparent !== undefined && (typeof traceparent !== 'string' || traceparent.length > MAX_DIAGNOSTIC_FIELD_LEN)) {
    return { traceparent: '' };
  }
  if (tracestate !== undefined && (typeof tracestate !== 'string' || tracestate.length > MAX_DIAGNOSTIC_FIELD_LEN)) {
    return { traceparent: '' };
  }
  return {
    ...(traceparent !== undefined ? { traceparent } : {}),
    ...(tracestate !== undefined ? { tracestate } : {}),
  };
}
