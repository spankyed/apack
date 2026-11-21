import {chatInteractions, chatInteractionScript, chatShotViewForFrame} from '../src/film/state/chat';
import {boardInteractions, boardInteractionScript, boardShotViewForFrame} from '../src/film/state/board';
import {
  notesEditorInteractions,
  notesEditorInteractionScript,
  notesEditorViewForFrame,
  notesHomeInteractions,
  notesHomeInteractionScript,
} from '../src/film/state/notes';
import type {InteractionModel, InteractionStep} from '../src/film/interaction/interactionTimeline';

/*
 * Enforces the interaction invariant across every scene that adopts the model:
 * the cursor is the single source of truth, and element states (press / hover /
 * menu-open) derive from it. If anyone re-introduces a hand-coded interaction
 * frame that drifts from the cursor, these checks go red.
 */

type Check = {detail: string; pass: boolean};
const checks: Check[] = [];
const expect = (detail: string, pass: boolean) => checks.push({detail, pass});

// Generic invariants that must hold for ANY interaction script.
function auditScript<T extends string>(scene: string, model: InteractionModel<T>, script: InteractionStep<T>[]) {
  for (const step of script.filter(s => s.click !== false)) {
    if (typeof step.to !== 'string') continue;
    expect(`[${scene}] press(${step.label}) active at its click ${step.end}`, model.pressed(step.to, step.end));
    expect(`[${scene}] press(${step.label}) quiet 40f before the move`, !model.pressed(step.to, step.start - 40));
  }
  for (const step of script) {
    if (typeof step.to !== 'string') continue;
    const mid = Math.floor((step.start + step.end) / 2);
    expect(`[${scene}] hover at ${step.label} (frame ${mid}) is its destination`, model.hovered(step.to, mid));
  }
  for (const step of script) {
    if (step.opens) {
      expect(`[${scene}] ${step.opens} closed before its opener click`, !model.opened(step.opens, step.end - 1));
      expect(`[${scene}] ${step.opens} open right after its opener click`, model.opened(step.opens, step.end + 1));
    }
    if (step.closes) {
      expect(`[${scene}] ${step.closes} open before its closer click`, model.opened(step.closes, step.end - 1));
      expect(`[${scene}] ${step.closes} closed right after its closer click`, !model.opened(step.closes, step.end + 1));
    }
  }
}

auditScript('chat', chatInteractions, chatInteractionScript);
auditScript('board', boardInteractions, boardInteractionScript);
auditScript('notes-home', notesHomeInteractions, notesHomeInteractionScript);
auditScript('notes-editor', notesEditorInteractions, notesEditorInteractionScript);

// Rendered-state cross-checks: the actual view states must agree with the cursor.
const chatComposer = (frame: number) => chatShotViewForFrame(frame).composer;

const sendClick = chatInteractions.clickFrame('sendButton')!;
expect('[chat] send button pressed when the cursor clicks it', chatComposer(sendClick).sendPressed === true);
expect('[chat] send button not pressed 30f before the cursor arrives', chatComposer(sendClick - 30).sendPressed !== true);
expect('[chat] send disables (text cleared) shortly after the send click', chatComposer(sendClick + 6).text === undefined);

const recentClick = chatInteractions.clickFrame('recentThreads')!;
expect('[chat] recent menu appears the moment the cursor clicks recent', Boolean(chatComposer(recentClick + 1).bottomTabs?.recentThreadsMenu));
expect('[chat] recent menu absent 20f before the click', !chatComposer(recentClick - 20).bottomTabs?.recentThreadsMenu);
expect('[chat] no row highlight before the cursor reaches a row', chatComposer(recentClick + 1).bottomTabs?.recentThreadsMenu?.selectedIndex !== 0);

const hoverRow = chatInteractionScript.find(step => step.label === 'hover-row')!;
const rowHoverFrame = Math.floor((hoverRow.start + hoverRow.end) / 2);
expect('[chat] hovered recent row is highlighted (selectedIndex 0)', chatComposer(rowHoverFrame).bottomTabs?.recentThreadsMenu?.selectedIndex === 0);

const quickBtnClick = chatInteractions.clickFrame('quickPromptsButton')!;
expect('[chat] quick-prompts menu opens on the button click', chatComposer(quickBtnClick + 1).quickPromptsOpen === true);
expect('[chat] quick-prompts button pressed at its click', chatComposer(quickBtnClick).quickPromptsButtonPressed === true);

const quickItemClick = chatInteractions.clickFrame('quickPromptFirst')!;
expect('[chat] quick-prompts menu closes when an item is clicked', chatComposer(quickItemClick + 2).quickPromptsOpen !== true);

const quickSendClick = chatInteractions.clickFrame('quickPromptSend')!;
expect('[chat] send pressed when the quick-prompt send is clicked', chatComposer(quickSendClick).sendPressed === true);
expect('[chat] send not pressed 20f before the quick-prompt send click', chatComposer(quickSendClick - 20).sendPressed !== true);

// Board: the dashboard pin and create-thread presses follow the cursor.
const pinClick = boardInteractions.clickFrame('activeDashboardTabPin')!;
expect('[board] pin pressed around its click', boardShotViewForFrame(pinClick + 6).dashboard?.pinPressed === true);
expect('[board] thread shows pinned after the pin click', boardShotViewForFrame(pinClick + 16).dashboard?.pinned === true);
expect('[board] thread not pinned 20f before the pin click', boardShotViewForFrame(pinClick - 20).dashboard?.pinned !== true);

// Notes editor: the tasklist/todo open as their clicks settle.
const tasklistClick = notesEditorInteractions.clickFrame('rightRailTasklist')!;
expect('[notes] tasklist note opens after its click settles', notesEditorViewForFrame(tasklistClick + 8).breadcrumbs.join('/').includes('Tasklist'));
expect('[notes] tasklist not open before its click', !notesEditorViewForFrame(tasklistClick - 10).breadcrumbs.join('/').includes('Tasklist'));
const checkboxClick = notesEditorInteractions.clickFrame('taskCheckbox')!;
expect('[notes] todo completes after the checkbox click', notesEditorViewForFrame(checkboxClick + 8).taskList.items.some(item => item.completed === true && item.id === 'receipt-emails'));

// Geometry-exact checks: the press fires with the click ripple, and the row
// highlight tracks the cursor sprite actually being over the row rect.
// Representative landscape (1440x900, animate:false) chat target rects.
const chatGeoTargets = {
  recentThreadRowFirst: {left: 338.72, top: 662, width: 834.56, height: 34},
  recentThreads: {left: 338.72, top: 820, width: 160, height: 28},
  sendButton: {left: 1169.6, top: 768, width: 92, height: 32},
  queueSendButton: {left: 1169.6, top: 768, width: 92, height: 32},
  approvePlanPrimary: {left: 0, top: 0, width: 10, height: 10},
  quickPromptsButton: {left: 0, top: 0, width: 10, height: 10},
  quickPromptFirst: {left: 0, top: 0, width: 10, height: 10},
  quickPromptSend: {left: 0, top: 0, width: 10, height: 10},
  threadsBreadcrumb: {left: 0, top: 0, width: 10, height: 10},
} as const;
const chatGeo = (frame: number) => ({frame, space: 'px' as const, targets: chatGeoTargets, viewport: {height: 900, width: 1440}});

// Press tracks the click ripple of the send move (source 264..282 — the move
// now starts only after the prompt finishes typing at ~263).
expect('[chat·geo] send pressed during the click ripple (~278)', chatInteractions.pressing('sendButton', 278));
expect('[chat·geo] send not pressed mid-travel, before the ripple (267)', !chatInteractions.pressing('sendButton', 267));
expect('[chat·geo] send not pressed once the click completes (286)', !chatInteractions.pressing('sendButton', 286));

// Hover tracks the cursor sprite being over the row rect.
expect('[chat·geo] row 0 hovered while the cursor is parked on it (499)', chatInteractions.over('recentThreadRowFirst', chatGeo(499)));
expect('[chat·geo] row 0 NOT hovered while the cursor is on the recent button (445)', !chatInteractions.over('recentThreadRowFirst', chatGeo(445)));

const failed = checks.filter(check => !check.pass);
if (failed.length > 0) {
  console.error(`Interaction audit failed: ${failed.length} of ${checks.length} checks.`);
  for (const check of failed) console.error(`- ${check.detail}`);
  process.exit(1);
}

console.log(`Interaction audit passed: ${checks.length} checks tying cursor movement to hover/press states across chat, board, and notes.`);
