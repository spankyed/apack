/** Native transcript rows retained inside one aggregated apack assistant message. */
export interface ClaudeNativeAssistantMessage {
  uuid: string;
  sessionId: string;
  text: string;
  start: number;
  end: number;
}

/** Match completed native rows only against newly observed text, never an earlier identical row. */
export function createClaudeNativeMessageTracker() {
  let rows: readonly ClaudeNativeAssistantMessage[] = [];
  let observedThrough = 0;
  const seen = new Set<string>();
  return {
    accept(currentText: string, message: { uuid?: string; sessionId?: string; text: string; parentToolUseId?: string }) {
      if (message.parentToolUseId || !message.text || (message.uuid && seen.has(message.uuid))) return { text: currentText, rows };
      if (message.uuid) seen.add(message.uuid);
      const pending = currentText.slice(observedThrough);
      // A completed-only block still belongs in the transcript after earlier streamed prose.
      // A block-start separator may already have arrived without any text deltas.
      const text = !pending ? currentText + (currentText ? '\n' : '') + message.text
        : pending === '\n' ? currentText + message.text : currentText;
      const end = text.length, start = end - message.text.length;
      if (message.uuid && message.sessionId && start >= observedThrough && text.slice(start, end) === message.text) {
        rows = [...rows, { uuid: message.uuid, sessionId: message.sessionId, text: message.text, start, end }];
      }
      observedThrough = end;
      return { text, rows };
    },
  };
}
