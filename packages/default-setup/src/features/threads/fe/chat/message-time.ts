let formatter: Intl.DateTimeFormat | undefined;
const options = { hour: '2-digit', minute: '2-digit' } as const;

export function formatMessageTime(date: Date): string {
  if (!Number.isFinite(date.getTime())) return date.toLocaleTimeString([], options);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat([], options);
    // Share across a render batch; the next batch must resolve the current locale and timezone again.
    queueMicrotask(() => { formatter = undefined; });
  }
  return formatter.format(date);
}
