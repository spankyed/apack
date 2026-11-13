// What a terminal's bell may put in a system notification. A window asks through its bridge when a bell rings while the
// window is not focused, and the notification is the main process's: a window cannot show one while it is unfocused,
// which is the case this exists for. The title and body come from a program, so they are untrusted whatever asked, and
// their length is the one rule decided here.
import {Notification, type IpcMain} from 'electron';

/** The longest title a notification may carry. Longer text is refused rather than cut, since a cut title is another title. */
export const MAX_NOTIFICATION_TITLE = 200;
/** The longest body a notification may carry, refused rather than cut for the same reason as the title */
export const MAX_NOTIFICATION_BODY = 1000;

/** Why a notification with this title and body may not be shown, or undefined when it may */
export function notificationProblem(title: unknown, body: unknown): string | undefined {
  if (typeof title !== 'string') return 'its title is not text';
  if (typeof body !== 'string') return 'its body is not text';
  if (title.length > MAX_NOTIFICATION_TITLE) return `its title is longer than ${MAX_NOTIFICATION_TITLE} characters`;
  if (body.length > MAX_NOTIFICATION_BODY) return `its body is longer than ${MAX_NOTIFICATION_BODY} characters`;
  return undefined;
}

/** Shows a system notification with `title` and `body`, answering whether it was shown */
export function showNotification(title: unknown, body: unknown): boolean {
  if (notificationProblem(title, body) !== undefined) return false;
  if (!Notification.isSupported()) return false;
  new Notification({title: title as string, body: body as string}).show();
  return true;
}

/**
 * The window within which a notification with the same title and body is shown once. Every window showing the code
 * surface receives a terminal's bell, so one bell reaches this handler once per unfocused window; the first ask shows
 * and the repeats inside this window show nothing. Identity is the text alone, so two different bells with the same
 * text inside the window show once.
 */
export const DUPLICATE_NOTIFICATION_WINDOW_MS = 1000;

/**
 * Answers the window's `notify:show` request with `showNotification`, showing an identical notification once per
 * `DUPLICATE_NOTIFICATION_WINDOW_MS`. `now` is the clock the window is measured on.
 */
export function registerNotifyHandler(ipc: Pick<IpcMain, 'handle'>, now: () => number = Date.now): void {
  const lastShown = new Map<string, number>();
  ipc.handle('notify:show', (_event, title: unknown, body: unknown) => {
    if (notificationProblem(title, body) !== undefined) return false;
    const at = now();
    for (const [key, shownAt] of lastShown) {
      if (at - shownAt >= DUPLICATE_NOTIFICATION_WINDOW_MS) lastShown.delete(key);
    }
    const key = JSON.stringify([title, body]);
    if (lastShown.has(key)) return false;
    const shown = showNotification(title, body);
    if (shown) lastShown.set(key, at);
    return shown;
  });
}
