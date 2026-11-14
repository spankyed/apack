// What a terminal's bell may put in a system notification. A window asks through its bridge when a bell rings while the
// window is not focused, and the notification is the main process's: a window cannot show one while it is unfocused,
// which is the case this exists for. The title and body come from a program, so they are untrusted whatever asked, and
// their length is the one rule decided here.
import {Notification, type IpcMain} from 'electron';

/** The longest title a notification may carry. Longer text is refused rather than cut, since a cut title is another title. */
export const MAX_NOTIFICATION_TITLE = 200;
/** The longest body a notification may carry, refused rather than cut for the same reason as the title */
export const MAX_NOTIFICATION_BODY = 1000;
/** The longest tag an ask may carry: the same rule as the title, refused rather than cut */
export const MAX_NOTIFICATION_TAG = MAX_NOTIFICATION_TITLE;

/**
 * Why a notification with this title, body and tag may not be shown, or undefined when it may. The tag is optional;
 * an absent one is `undefined`, and a present one must be text of at most `MAX_NOTIFICATION_TAG` characters.
 */
export function notificationProblem(title: unknown, body: unknown, tag?: unknown): string | undefined {
  if (typeof title !== 'string') return 'its title is not text';
  if (typeof body !== 'string') return 'its body is not text';
  if (title.length > MAX_NOTIFICATION_TITLE) return `its title is longer than ${MAX_NOTIFICATION_TITLE} characters`;
  if (body.length > MAX_NOTIFICATION_BODY) return `its body is longer than ${MAX_NOTIFICATION_BODY} characters`;
  if (tag !== undefined) {
    if (typeof tag !== 'string') return 'its tag is not text';
    if (tag.length > MAX_NOTIFICATION_TAG) return `its tag is longer than ${MAX_NOTIFICATION_TAG} characters`;
  }
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
 * How long a shown tag is remembered. Every window showing the code surface receives a terminal's bell, so one bell
 * reaches the handler once per unfocused window, each with the same tag; a tag shown within this window is not shown
 * again. Past it the tag is forgotten, so the set holds only the tags shown in the last minute. The bound is time
 * rather than a count: a bell is a human-scale event, and a program that rings faster than this is not one the
 * person can read anyway.
 */
export const TAG_MEMORY_MS = 60_000;

/**
 * Answers the window's `notify:show` request with `showNotification`. An ask carrying a tag is shown once per tag
 * within `TAG_MEMORY_MS`; identity is the tag, so two bells with the same title and body but different tags both
 * show, and an ask with no tag is shown every time. `now` is the clock the tags are measured on.
 */
export function registerNotifyHandler(ipc: Pick<IpcMain, 'handle'>, now: () => number = Date.now): void {
  const shownAt = new Map<string, number>();
  ipc.handle('notify:show', (_event, title: unknown, body: unknown, tag?: unknown) => {
    if (notificationProblem(title, body, tag) !== undefined) return false;
    const at = now();
    for (const [key, when] of shownAt) {
      if (at - when >= TAG_MEMORY_MS) shownAt.delete(key);
    }
    const identity = typeof tag === 'string' ? tag : undefined;
    if (identity !== undefined && shownAt.has(identity)) return false;
    const shown = showNotification(title, body);
    if (shown && identity !== undefined) shownAt.set(identity, at);
    return shown;
  });
}
