import type { createPerformanceController, RecordingMode } from '@apackdev/host/diagnostics';
import type { ViewRequest, ViewUpdate } from '@apackdev/sdk/framework';

type Controller = ReturnType<typeof createPerformanceController>;
export interface PerformanceViewDelivery { request: ViewRequest; update: ViewUpdate; generation: number; delivery: number }
export interface PerformanceViewCompletion {
  accept(delivery: PerformanceViewDelivery): boolean;
  check(): boolean;
  dispatch(): void;
  errors: readonly string[];
  /**
   * Whether readiness waits for a view delivery this completion accepted. Default true.
   *
   * It has to be true for an action whose result is a **view**: the DOM changes while a page is still
   * filling, so checking on mutation alone would complete the trial before the data it is measuring had
   * arrived. It has to be false for an action whose result is a **feed** — a terminal's output is broadcast
   * news and the code feature declares no views at all, so there is no delivery to accept and the only
   * readiness there is is what the window has drawn.
   */
  awaitsDelivery?: boolean;
  /**
   * A signal that readiness may have changed, for an action whose result changes neither a view nor the DOM.
   *
   * The loop's two built-in triggers are a view delivery and a DOM mutation. A resize has neither: no view,
   * and xterm draws to a canvas, so the screen changing mutates nothing the observer sees. Rather than poll,
   * such a completion subscribes to whatever does know — the surface's actor — and returns its unsubscribe.
   */
  subscribe?: (notify: () => void) => () => void;
}
export interface PerformanceWindow {
  __waitForPerformanceView(options: PerformanceViewCompletion): Promise<void>;
  __sendToSystem(system: string, event: Record<string, unknown>): void;
  __performance: {
    start(mode: RecordingMode): Promise<void>;
    begin: Controller['begin'];
    withinStartup<T>(fn: () => T): T;
    lastStartupView(ref: string, view: string): { entityId?: string; ok: boolean; commit: number; subscription?: string; delivery?: number } | undefined;
    flushView(): Promise<void>;
    onView(listener: (delivery: PerformanceViewDelivery) => void): () => void;
    stop(): Promise<{ renderer?: Awaited<ReturnType<Controller['stop']>>; backend?: Awaited<ReturnType<Controller['stop']>>; complete: boolean }>;
  };
  applicationState: {
    getSnapshot(): { value: unknown; context: Record<string, unknown> };
    send(event: Record<string, unknown>): void;
    // The threads surface's context, which three scenarios read, plus the code surface's panel fields. A
    // surface addressed here answers with its own context; the optional half is what the others hold.
    system: { get(ref: string): { send(event: Record<string, unknown>): void; getSnapshot(): {
      context: { currentThread?: { id: string }; chatMessageIds: string[]; chatLimit: number; messageContents: Record<string, { text?: string; sender?: string; responseTimestamp?: number }>; messageSearch: { query: string; searching: boolean; results: Array<{ messageId: string; threadId: string; timestamp: number }> }; panelTerminalId?: string | null; panelTerminalExpanded?: boolean };
      // A surface's children are private to it; a scenario reads one only to assert what the surface did,
      // never to drive it — the code surface routes `<child>.*` by prefix, which is how a send gets there.
      children?: Record<string, { getSnapshot(): { context: { terminals?: Array<{ id: string; cols?: number; rows?: number }> } } } | undefined>;
    }; subscribe(listener: () => void): { unsubscribe(): void } } };
  };
}

