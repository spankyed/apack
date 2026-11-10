// A terminal in the real app: drawn from rows its broker sends, typed into through the view, and read back
// off the page.
//
// Everything below the window is proven in the broker's and the view's own suites. What only this proves
// is that they meet: a window reaches the broker itself, the screen a shell draws arrives as rows and is
// painted, and what is typed into the view reaches the shell — with the API process carrying none of it.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '@apackdev/testing';

const CODE = 'default-setup/code';

type DrivenWindow = {
  __sendToSystem: (systemId: string, event: Record<string, unknown>) => void;
  applicationState: { send(event: Record<string, unknown>): void };
};

/** The text on a terminal's screen, a row a line, as the view publishes it for whatever reads a page */
const screen = (appPage: Page, terminalId: string): Promise<string> =>
  appPage.locator(`[data-apack-terminal="${terminalId}"] [data-terminal-text] > div`).allTextContents()
    .then((rows) => rows.join('\n'));

/** Opens a terminal in the panel and answers its id once a view of it is on the page */
async function openTerminal(appPage: Page): Promise<string> {
  const drawn = appPage.locator('[data-apack-terminal]');
  const ids = (): Promise<string[]> => drawn.evaluateAll((all) => all.map((el) => (el as HTMLElement).dataset.apackTerminal!));
  // The app outlives a test, so a terminal an earlier one opened may still be drawn
  const before = await ids();
  await appPage.evaluate((code) => {
    (window as unknown as DrivenWindow).applicationState.send({ type: 'SEND_TO_SURFACE', surface: code, events: [{ type: 'terminal.CREATE' }] });
  }, CODE);
  let opened: string | undefined;
  await expect.poll(async () => (opened = (await ids()).find((id) => !before.includes(id)))).toBeTruthy();
  // Drawn: the view says which frame it has painted once it has painted one
  await expect(appPage.locator(`[data-apack-terminal="${opened!}"][data-terminal-drawn]`)).toBeVisible();
  return opened!;
}

/** Types into the terminal the way a person does: with the keyboard, into the view */
async function type(appPage: Page, terminalId: string, text: string): Promise<void> {
  await appPage.locator(`[data-apack-terminal="${terminalId}"] textarea`).focus();
  await appPage.keyboard.type(text);
}

let workDir: string | undefined;
test.afterEach(() => {
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  workDir = undefined;
});

test.beforeEach(async ({ app, appPage }) => {
  workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-terminal-view-')));
  await app.waitForSurface(CODE);
  await app.navigate(CODE);
  await appPage.evaluate(({ code, dir }) => {
    (window as unknown as DrivenWindow).__sendToSystem(code, { type: 'SET_BASE_DIRECTORY', path: dir, fromUserNavigation: false });
  }, { code: CODE, dir: workDir });
});

test('a shell is drawn, and what is typed into it runs', async ({ appPage }) => {
  const terminalId = await openTerminal(appPage);

  // Arithmetic, so what is waited for is the command's output and not the echo of what was typed
  await type(appPage, terminalId, 'echo vi$((40+2))ew\n');
  await expect.poll(() => screen(appPage, terminalId), { timeout: 20_000 }).toContain('vi42ew');
});

/**
 * A program asks the terminal where the cursor is and reads what comes back. One terminal answers: the
 * broker's. A window that interpreted the same bytes answered too, and the program read the report twice.
 */
test('a program that asks the terminal a question is answered once', async ({ appPage }) => {
  const terminalId = await openTerminal(appPage);
  // Ask, give a late second answer a full second to arrive, then read everything waiting, as hex
  await type(appPage, terminalId,
    `stty raw -echo min 0 time 10; printf '\\033[6n'; sleep 1; printf 'REPLY=[%s]\\n' "$(dd bs=64 count=1 2>/dev/null | xxd -p | tr -d '\\n')"; stty sane\n`);

  let hex: string | undefined;
  await expect.poll(async () => (hex = /REPLY=\[([0-9a-f]+)\]/.exec((await screen(appPage, terminalId)).replace(/\n/g, ''))?.[1]),
    { timeout: 20_000 }).toBeDefined();
  const read = Buffer.from(hex!, 'hex').toString('latin1');
  const reports = read.match(new RegExp(`${String.fromCharCode(27)}\\[\\d+;\\d+R`, 'g')) ?? [];

  expect(reports, `the program read ${JSON.stringify(read)}`).toHaveLength(1);
});

/**
 * Pasted text holding the marker that ends a bracketed paste would close the bracket early, and what
 * followed would run as if typed. The broker refuses such a paste until the person has seen it.
 */
test('a paste that could run a command is shown to the person, and runs nothing unless they say so', async ({ appPage }) => {
  const terminalId = await openTerminal(appPage);
  await type(appPage, terminalId, 'echo rea$((1+1))dy\n');
  await expect.poll(() => screen(appPage, terminalId)).toContain('rea2dy');

  const paste = (text: string) => appPage.evaluate(({ id, text }) => {
    const field = document.querySelector<HTMLElement>(`[data-apack-terminal="${id}"] textarea`)!;
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    field.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, { id: terminalId, text });

  await paste('echo held\x1b[201~\recho IN$((40+2))J\r');
  const asking = appPage.locator('[data-terminal-paste-confirm]');
  await expect(asking).toBeVisible();
  await expect(asking).toContainText('echo held');
  await asking.locator('[data-terminal-paste-answer="cancel"]').click();
  await expect(asking).toHaveCount(0);

  // Something after it, so there is an end to wait for
  await type(appPage, terminalId, 'echo aft$((2+1))er\n');
  await expect.poll(() => screen(appPage, terminalId), { timeout: 20_000 }).toContain('aft3er');
  expect(await screen(appPage, terminalId), 'the refused paste ran').not.toContain('IN42J');
});

/**
 * What a program prints is drawn from its session and is no event. What it *does* — here, asking for text
 * on the clipboard — is one, and reaches the surface from the system.
 */
test('what a program asks of the world outside its screen reaches the surface', async ({ appPage }) => {
  await appPage.evaluate((code) => {
    const win = window as unknown as DrivenWindow & {
      __asked?: string[];
      applicationState: { system: { inspect(observer: (inspection: { type: string; actorRef: { id: string }; event: { type: string; data?: { text?: string } } }) => void): void } };
    };
    win.__asked = [];
    win.applicationState.system.inspect((inspection) => {
      if (inspection.type === '@xstate.event' && inspection.actorRef?.id === code && inspection.event.type === 'terminal.CLIPBOARD') {
        win.__asked!.push(inspection.event.data?.text ?? '');
      }
    });
  }, CODE);
  const terminalId = await openTerminal(appPage);

  await type(appPage, terminalId, `printf '\\033]52;c;${Buffer.from('copied-by-a-program').toString('base64')}\\007'\n`);

  await expect.poll(() => appPage.evaluate(() => (window as unknown as { __asked?: string[] }).__asked ?? []), { timeout: 20_000 })
    .toContain('copied-by-a-program');
});
