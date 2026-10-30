import type { createPerformanceController, RecordingMode } from '@apackdev/host/diagnostics';
import type { ViewRequest, ViewUpdate } from '@apackdev/sdk/framework';

type Controller = ReturnType<typeof createPerformanceController>;
export interface PerformanceWindow {
  __sendToSystem(system: string, event: Record<string, unknown>): void;
  __performance: {
    start(mode: RecordingMode): Promise<void>;
    begin: Controller['begin']; flushView(): Promise<void>;
    onView(listener: (delivery: { request: ViewRequest; update: ViewUpdate; generation: number; delivery: number }) => void): () => void;
    stop(): Promise<{ renderer?: Awaited<ReturnType<Controller['stop']>>; backend?: Awaited<ReturnType<Controller['stop']>>; complete: boolean }>;
  };
  applicationState: {
    send(event: Record<string, unknown>): void;
    system: { get(ref: string): { getSnapshot(): { context: { currentThread?: { id: string }; chatMessageIds: string[]; chatLimit: number; messageContents: Record<string, { text?: string; sender?: string; responseTimestamp?: number }>; messageSearch: { query: string; searching: boolean; results: Array<{ messageId: string; threadId: string; timestamp: number }> } } } } };
  };
}

