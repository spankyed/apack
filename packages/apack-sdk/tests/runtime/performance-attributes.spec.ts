// What an observation costs while nothing is recording.
//
// `_recordPerformance`'s callers are hot paths and their attributes are expensive to compute: the one in the
// API's emitter serialises the message to size it, on a path that runs per streamed token and per terminal
// frame. So the thunk must reach the recording implementation uncalled, and only a run that is recording may
// pay for it.
//
// **The trap this pins is that a bound execution is not a recording one.** Development and test bind one
// always, so a guard on "is anything bound" reads as protection and charges every such run for a measurement
// nobody collects.
import { describe, expect, it, vi } from 'vitest';
import { _recordPerformance } from '../../src/runtime/performance.ts';
import { bindFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts';

/** A bound frontend host whose execution records nothing, which is what an unrecorded run looks like */
function boundWithIdleExecution() {
  const record = vi.fn();
  bindFeHost({
    application: {} as never, secrets: {} as never, settings: {} as never, catalog: {} as never,
    client: { send() {}, watchView: () => () => {} },
    packs: {} as never,
    diagnostics: { record, capture: () => ({}), withCarrier: (_carrier: unknown, run: () => unknown) => run(), carryEvent: () => {}, attach: () => {} } as never,
  } as never);
  return record;
}

describe('what an observation costs while nothing records', () => {
  it('hands the attributes over uncalled, so the implementation decides whether to pay', () => {
    const record = boundWithIdleExecution();
    const attributes = vi.fn(() => ({ 'app.bytes': 7 }));

    _recordPerformance('app.surface.send', attributes);

    expect(record, 'the observation never reached the execution').toHaveBeenCalledTimes(1);
    expect(attributes, 'the attributes were computed before anything asked for them').not.toHaveBeenCalled();
    // And they are what was handed over, so an implementation that does record still gets them
    expect(record.mock.calls[0]?.[1]).toBe(attributes);
    unbindFeHost();
  });
});
