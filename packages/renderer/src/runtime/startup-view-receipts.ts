import type { PerformanceViewDelivery } from './performance.ts';

export interface StartupViewReceipt {
  entityId?: string;
  commit: number;
  subscription?: string;
  delivery?: number;
  ok: boolean;
}

/** Startup qualification retains only bounded view identities and revisions, never view values or arbitrary arguments. */
export function createStartupViewReceipts() {
  const views = new Map<string, StartupViewReceipt>();
  return {
    record({ request, update }: PerformanceViewDelivery): boolean {
      const chatId = request.view === 'chat' && typeof request.args === 'object' && request.args !== null
        ? (request.args as { threadId?: unknown }).threadId : undefined;
      if (request.args !== undefined && !(typeof chatId === 'string' && chatId.length <= 128)) return true;
      const { ref, view } = request;
      const key = `${ref}\0${view}`;
      if (ref.length > 128 || view.length > 128 || !views.has(key) && views.size >= 32) return false;
      views.set(key, { ...(typeof chatId === 'string' && { entityId: chatId }), ok: update.ok, commit: update.commit,
        subscription: update.diagnostics?.subscription, delivery: update.diagnostics?.delivery });
      return true;
    },
    last(ref: string, view: string): StartupViewReceipt | undefined {
      const receipt = views.get(`${ref}\0${view}`);
      return receipt && { ...receipt };
    },
  };
}
