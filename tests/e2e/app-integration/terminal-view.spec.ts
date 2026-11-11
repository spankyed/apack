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

/** The text a recording being looked back through shows, which is drawn by a view of its own */
const lookedBackAt = (appPage: Page): Promise<string> =>
  appPage.locator('[data-terminal-rewind] [data-terminal-text] > div').allTextContents().then((rows) => rows.join('\n'));

/**
 * The shell is started with a hook that marks each command, the broker reads the marks, and the window is
 * told the commands. Nothing in the app parses a prompt: an action that needs a finished command is
 * offered exactly when the shell has reported one.
 */
test('the commands a shell runs are marked, and text on its screen is found', async ({ appPage }) => {
  const terminalId = await openTerminal(appPage);
  const terminal = appPage.locator(`[data-apack-terminal="${terminalId}"]`);
  await type(appPage, terminalId, 'echo mar$((1+1))ked\n');
  await expect.poll(() => screen(appPage, terminalId), { timeout: 20_000 }).toContain('mar2ked');

  const copyOutput = appPage.locator('[data-terminal-menu="copy-output"]');
  await expect(async () => {
    await terminal.click({ button: 'right' });
    await expect(copyOutput).toBeVisible();
    await expect(copyOutput, 'no finished command reached the window').not.toHaveAttribute('data-disabled');
  }).toPass({ timeout: 20_000 });

  await appPage.locator('[data-terminal-menu="find"]').click();
  const find = appPage.locator('[data-terminal-find]');
  await find.locator('input').fill('mar2ked');
  await expect(find.locator('[data-terminal-find-count]')).toHaveText(/^1 of \d+$/);
  await find.locator('input').press('Escape');
  await expect(find).toHaveCount(0);
});

/**
 * A terminal is recorded, so the shell that replaces one starts under what the last one printed, and what
 * it printed can be looked back through.
 */
test('a terminal keeps its screen when its shell is replaced, and can be looked back through', async ({ appPage }) => {
  const terminalId = await openTerminal(appPage);
  const terminal = appPage.locator(`[data-apack-terminal="${terminalId}"]`);
  await type(appPage, terminalId, 'echo bef$((1+1))ore\n');
  await expect.poll(() => screen(appPage, terminalId), { timeout: 20_000 }).toContain('bef2ore');

  await terminal.click({ button: 'right' });
  await appPage.locator('[data-terminal-menu="rewind"]').click();
  const lookingBack = appPage.locator('[data-terminal-rewind]');
  await expect(lookingBack).toBeVisible();
  await expect.poll(() => lookedBackAt(appPage), { timeout: 20_000 }).toContain('bef2ore');
  // The first moment the recording holds is before anything was typed
  await lookingBack.locator('[data-terminal-rewind-moment]').evaluate((moment: HTMLInputElement) => {
    moment.value = moment.min;
    moment.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => lookedBackAt(appPage), { timeout: 20_000 }).not.toContain('bef2ore');
  await lookingBack.locator('[data-terminal-rewind-close]').click();
  await expect(lookingBack).toHaveCount(0);

  await appPage.evaluate(({ code, id }) => {
    (window as unknown as DrivenWindow).applicationState.send({ type: 'SEND_TO_SURFACE', surface: code, events: [{ type: 'terminal.RESTART', terminalId: id }] });
  }, { code: CODE, id: terminalId });
  await expect(appPage.locator(`[data-apack-terminal="${terminalId}"] ~ [data-terminal-notice="restarted"], [data-terminal-notice="restarted"]`).first())
    .toBeVisible({ timeout: 20_000 });
  // The new shell is typed at, under what the old one printed
  await type(appPage, terminalId, 'echo aft$((1+2))er\n');
  await expect.poll(() => screen(appPage, terminalId), { timeout: 20_000 }).toContain('aft3er');
  expect(await screen(appPage, terminalId), 'the shell that replaced it started on an empty screen').toContain('bef2ore');
});

/**
 * Selecting is the view's, and what a word is is the broker's: a double click asks the session where the
 * word under it ends, and copying asks it for the text. Driven with the real pointer, whose events are
 * not the ones a page can make up.
 */
test('a double click selects the word under it, and copying puts it on the clipboard', async ({ appPage, electronApp }) => {
  const terminalId = await openTerminal(appPage);
  await type(appPage, terminalId, 'echo; echo sel$((40+2))ected-word here\n');
  await expect.poll(() => screen(appPage, terminalId), { timeout: 20_000 }).toContain('sel42ected-word here');

  // Where the word was printed: its row among the rows on screen, and its column in that row
  const rows = (await screen(appPage, terminalId)).split('\n');
  const row = rows.findIndex((text) => text.startsWith('sel42ected-word'));
  const canvas = appPage.locator(`[data-apack-terminal="${terminalId}"] canvas`);
  const box = (await canvas.boundingBox())!;
  const cellHeight = box.height / rows.length;
  // Well inside the word, whatever a cell's width is: the grid starts at the gutter's edge
  const x = box.x + 8 + 30;
  const y = box.y + (row + 0.5) * cellHeight;

  await electronApp.evaluate(({ clipboard }) => clipboard.writeText('nothing copied'));
  await appPage.mouse.dblclick(x, y);
  await appPage.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+Shift+c');
  await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10_000 })
    .toBe('sel42ected-word');
});

/**
 * A target is a broker somewhere else, reached through a command. Here it is a second broker on this
 * machine, reached through the broker's own proxy — everything `ssh host apack-terminal proxy …` is but
 * the transport — and the window draws its terminal from the socket the app puts in front of that command.
 */
test('a terminal on a target is drawn and typed at like any other', async ({ app, appPage }) => {
  const broker = path.resolve('vendor/apack-terminal/node/apack-terminal');
  test.skip(!fs.existsSync(broker) || process.platform === 'win32', 'needs the staged broker binary');
  const far = path.join(workDir!, 'far.sock');
  // Named where a person names one: in the code feature's settings
  await app.navigate('host/settings');
  await appPage.evaluate((code) => {
    const settings = (window as unknown as { applicationState: { system: { get(ref: string): { send(event: Record<string, unknown>): void } } } })
      .applicationState.system.get('host/settings');
    settings.send({ type: 'TAB.SELECT', tab: 'features' });
    settings.send({ type: 'FEATURE.SELECT', featureId: code });
  }, CODE);
  await appPage.getByRole('button', { name: 'Terminal Targets' }).click();
  await appPage.getByLabel("New target's name").fill('elsewhere');
  await appPage.getByLabel("New target's command").fill(`"${broker}" proxy "${far}"`);
  await appPage.getByLabel("New target's command").press('Enter');
  await expect(appPage.locator('[data-terminal-target-row]')).toHaveCount(1);
  await app.navigate(CODE);

  const drawn = appPage.locator('[data-apack-terminal]');
  const ids = (): Promise<string[]> => drawn.evaluateAll((all) => all.map((el) => (el as HTMLElement).dataset.apackTerminal!));
  const before = await ids();
  await appPage.locator('button[title="Terminal actions"]').click();
  await appPage.locator('[data-terminal-target]').click();
  let terminalId: string | undefined;
  await expect.poll(async () => (terminalId = (await ids()).find((id) => !before.includes(id))), { timeout: 20_000 }).toBeTruthy();
  await expect(appPage.locator(`[data-apack-terminal="${terminalId!}"][data-terminal-drawn]`)).toBeVisible({ timeout: 20_000 });
  await expect(appPage.locator('[data-terminal-on]').last()).toHaveText('elsewhere');

  await type(appPage, terminalId!, 'echo fa$((1+1))r\n');
  await expect.poll(() => screen(appPage, terminalId!), { timeout: 20_000 }).toContain('fa2r');
  // The broker the command reached is one of its own, listening where the command said
  expect(fs.existsSync(far), 'no broker was started where the target said').toBe(true);
});

