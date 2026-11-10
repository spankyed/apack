// The window's terminal fixes, in the real app with the real emulator.
//
// Each of these was found by reading the two halves and probing each core alone, and fixed against a
// stand-in emulator (`docs/issues/ISSUE-ghostty-integration-review.md`). This is the first place they meet
// the emulator, the broker and a shell together.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '@apackdev/testing';

const CODE = 'default-setup/code';
const ESC = '\u001b';

interface Received { type: string; data?: { terminalId?: string; data?: string } }
type DrivenWindow = {
  __output?: Received[];
  __sendToSystem: (systemId: string, event: Record<string, unknown>) => void;
  applicationState: {
    send(event: Record<string, unknown>): void;
    system: { inspect(observer: (event: { type: string; actorRef: { id: string }; event: Received }) => void): void };
  };
};

/** Everything each terminal has printed since this was called, by terminal */
async function recordOutput(appPage: Page): Promise<void> {
  await appPage.evaluate((code) => {
    const win = window as unknown as DrivenWindow;
    if (win.__output) return;
    win.__output = [];
    win.applicationState.system.inspect((inspection) => {
      if (inspection.type === '@xstate.event' && inspection.actorRef?.id === code && inspection.event.type === 'terminal.OUTPUT') {
        win.__output!.push(JSON.parse(JSON.stringify(inspection.event)) as Received);
      }
    });
  }, CODE);
}

const outputOf = (appPage: Page, terminalId: string): Promise<string> =>
  appPage.evaluate((id) => ((window as unknown as DrivenWindow).__output ?? [])
    .filter((event) => event.data?.terminalId === id).map((event) => event.data?.data ?? '').join(''), terminalId);

/** Output with its styling and cursor movement taken out: a shell's line editor styles a paste a cell at a time */
const withoutStyling = (output: string): string => output.replace(new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g'), '');

const type = (appPage: Page, terminalId: string, data: string): Promise<void> =>
  appPage.evaluate(({ code, terminalId, data }) => {
    (window as unknown as DrivenWindow).__sendToSystem(code, { type: 'terminal.TERMINAL_INPUT', terminalId, data });
  }, { code: CODE, terminalId, data });

/** Opens a terminal in the panel, which is what builds an emulator for it in this window. Answers its id */
async function openTerminal(appPage: Page): Promise<string> {
  const drawn = appPage.locator('[data-apack-terminal]:has(canvas)');
  const drawnIds = (): Promise<string[]> => drawn.evaluateAll((all) => all.map((el) => (el as HTMLElement).dataset.apackTerminal!));
  // The app outlives a test, so a terminal an earlier one opened may still be drawn
  const before = await drawnIds();
  await appPage.evaluate((code) => {
    (window as unknown as DrivenWindow).applicationState.send({ type: 'SEND_TO_SURFACE', surface: code, events: [{ type: 'terminal.CREATE' }] });
  }, CODE);
  let opened: string | undefined;
  await expect.poll(async () => (opened = (await drawnIds()).find((id) => !before.includes(id)))).toBeTruthy();
  return opened!;
}

let workDir: string | undefined;
test.afterEach(() => {
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  workDir = undefined;
});

test.beforeEach(async ({ app, appPage }) => {
  workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-terminal-fixes-')));
  await app.waitForSurface(CODE);
  await app.navigate(CODE);
  await appPage.evaluate(({ code, dir }) => {
    (window as unknown as DrivenWindow).__sendToSystem(code, { type: 'SET_BASE_DIRECTORY', path: dir, fromUserNavigation: false });
  }, { code: CODE, dir: workDir });
  await recordOutput(appPage);
});

/**
 * A program asks where the cursor is and reads what comes back. The broker answers; the window's emulator
 * used to answer too, through the keystroke channel, so a second report arrived as if typed.
 */
test('a program that asks the terminal a question is answered once', async ({ appPage }) => {
  const terminalId = await openTerminal(appPage);
  // Ask, give a late second answer a full second to arrive, then read everything waiting, as hex
  await type(appPage, terminalId,
    `stty raw -echo min 0 time 10; printf '\\033[6n'; sleep 1; printf 'REPLY=[%s]\\n' "$(dd bs=64 count=1 2>/dev/null | xxd -p | tr -d '\\n')"; stty sane\r`);

  await expect.poll(async () => /REPLY=\[([0-9a-f]*)\]/.exec(await outputOf(appPage, terminalId))?.[1], { timeout: 20_000 }).toBeDefined();
  const hex = /REPLY=\[([0-9a-f]*)\]/.exec(await outputOf(appPage, terminalId))![1]!;
  const reports = Buffer.from(hex, 'hex').toString('latin1').match(new RegExp(`${ESC}\\[\\d+;\\d+R`, 'g')) ?? [];

  expect(reports, `the program read ${JSON.stringify(Buffer.from(hex, 'hex').toString('latin1'))}`).toHaveLength(1);
});

/**
 * Pasted text holding the marker that ends a bracketed paste used to close the bracket early, and what
 * followed ran as if typed.
 */
test('a paste cannot run a command by ending its own bracket', async ({ appPage }) => {
  const terminalId = await openTerminal(appPage);
  await type(appPage, terminalId, 'echo ready-$((1+1))\r');
  await expect.poll(() => outputOf(appPage, terminalId)).toContain('ready-2');

  await appPage.evaluate((id) => {
    const wrapper = document.querySelector<HTMLElement>(`[data-apack-terminal="${id}"]`)!;
    const target = wrapper.querySelector('textarea') ?? wrapper;
    const clipboardData = new DataTransfer();
    // Typed, this is one line the shell holds in its editor. If the marker ends the paste, the rest runs
    clipboardData.setData('text/plain', 'echo held\x1b[201~\recho INJ-$((40+2))\r');
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, terminalId);

  // The shell echoes what it is handed, so its last line on screen is the whole paste having arrived
  await expect.poll(async () => withoutStyling(await outputOf(appPage, terminalId)), { timeout: 20_000 }).toContain('INJ-$((40+2))');
  // Run something after it, so there is an end to wait for whichever way the paste went
  await type(appPage, terminalId, '\x03');
  await type(appPage, terminalId, 'echo after-$((2+1))\r');
  await expect.poll(() => outputOf(appPage, terminalId), { timeout: 20_000 }).toContain('after-3');

  expect(await outputOf(appPage, terminalId), 'the text after the forged marker was run').not.toContain('INJ-42');
});
