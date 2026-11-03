import { _carryPerformanceEvent } from '../runtime/performance.ts';
// A view, followed by a surface's machine rather than by a component. A surface drawn in more than one place — a
// canvas route and the chat area, say — has no one component that is always mounted while it runs, so a view held
// in one would stop while another area showed, and a view held in each would arrive twice. An actor the machine spawns
// lives exactly as long as the machine wants the view: spawned with its arguments, stopped (or replaced with new
// arguments) when the machine stops wanting them.
//
// `fromView` from a pack's `#generated/fe` is the typed door. This is its untyped twin, for a view named by data or
// another pack's.
import { fromCallback, type AnyEventObject, type CallbackActorLogic, type EventObject } from 'xstate'
import { boundFeHost } from '../runtime/fe-host.ts'
import type { ViewRequest, ViewUpdate } from '../framework/views.ts'

/**
 * Actor logic that follows the view `view` of the feature at `ref` for the arguments it is spawned with (its input;
 * none for a view without arguments), and sends its parent `read(update, args)` for its result and for each changed
 * result after it, until it is stopped. Nothing an update delivers after the stop reaches the parent.
 */
export function untypedFromView<Result, Args, TEvent extends EventObject>(
  ref: string,
  view: string,
  read: (update: ViewUpdate<Result>, args: Args) => TEvent,
): CallbackActorLogic<AnyEventObject, Args> {
  return fromCallback<AnyEventObject, Args>(({ input, sendBack }) => {
    const request: ViewRequest = input === undefined ? { ref, view } : { ref, view, args: input };
    let open = true;
    const unsubscribe = boundFeHost().client.watchView(request, (update) => {
      if (!open) return;
      const event = read(update as ViewUpdate<Result>, input);
      _carryPerformanceEvent(event, update.diagnostics?.carrier);
      sendBack(event);
    });
    return () => {
      open = false;
      unsubscribe();
    };
  });
}
