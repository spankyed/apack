import {readFileSync} from 'node:fs';
import {cursorOpacityForFrame} from '../src/film/overlays/Cursor';
import {cursorTimeline, percentTarget} from '../src/film/interaction/cursorTargets';
import {boardShotState, boardViewForFrame} from '../src/film/state/board';
import {
  chatShotState,
  chatShotViewForFrame,
  chatToolActivity,
  chatViewForFrame,
  launchComposerWithAttachmentState,
  launchPlanArtifact,
  toolActivityViewForFrame,
} from '../src/film/state/chat';
import {calendarBeats, calendarBreadcrumbsForFrame, calendarViewForFrame} from '../src/film/state/calendar';
import {calendarDayNumberTarget} from '../src/film/shots/calendarGeometry';
import {codeReviewViewForFrame, codeShotState, codeShotViewForFrame} from '../src/film/state/code';
import {finalShotState, finalViewForFrame} from '../src/film/state/final';
import {launchFilmStory} from '../src/film/state/launchStory';
import {montageDissolveFrames, montageSegmentBoundaries, montageShotViewForFrame} from '../src/film/state/montage';
import {notesHomeNewNoteButtonTarget} from '../src/film/shots/notesGeometry';
import {notesEditorViewForFrame, notesHomeState, notesHomeViewForFrame, notesRightRailState, notesTaskListItems} from '../src/film/state/notes';
import {cutFrames, shotCuts, shotSourceDurations, shots, type ContentShotId} from '../src/film/state/timeline';
import {workflowBeats, workflowStateForFrame} from '../src/film/state/workflow';

type Check = {
  area: ProductArea | 'final';
  message: string;
  pass: boolean;
};

type ProductArea = 'board' | 'browser' | 'calendar' | 'chat' | 'code' | 'notes' | 'workflow';

function changed<T>(before: T, after: T) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function chatTasklistReferenceSelectionPass() {
  const selectingView = chatShotViewForFrame(120).composer.referenceAutocomplete;
  const insertedNode = chatShotViewForFrame(160).composer.content?.[1];
  return selectingView?.level === 'items'
    && selectingView.selectedIndex === 1
    && selectingView.suggestions[1]?.label === 'Tasklist'
    && insertedNode?.type === 'reference'
    && insertedNode.label === 'Tasklist'
    && chatViewForFrame(160).prompt === chatViewForFrame(168).prompt;
}

function chatApprovedSummaryDelayPass() {
  const beforeDelay = chatShotViewForFrame(428).conversation.additionalAssistantMessages ?? [];
  const afterDelay = chatShotViewForFrame(436).conversation.additionalAssistantMessages ?? [];
  return !beforeDelay.some(message => message.markdown.includes('Approved checkout implementation plan'))
    && afterDelay.some(message => message.markdown.includes('Approved checkout implementation plan'));
}

function chatAttachmentMatchesStoryboardPass() {
  const fixtureAttachment = launchComposerWithAttachmentState.attachments?.[0];
  const shotAttachment = chatShotViewForFrame(220).composer.attachments?.[0];
  const svg = decodeURIComponent(String(shotAttachment?.previewUrl ?? '').replace(/^data:image\/svg\+xml,/, ''));

  return fixtureAttachment?.label === 'checkout mockup'
    && shotAttachment?.label === 'checkout mockup'
    && svg.includes('Supafan Checkout')
    && svg.includes('Pay with Stripe');
}

function chatStoryboardContentPass() {
  return chatShotState.breadcrumbs.join(' > ') === `Threads > ${launchFilmStory.threads.checkoutImplementation.title}`
    && chatShotState.prompt.text === 'Use #notes:tasklist and this screenshot to scope the checkout flow — Stripe payments, receipts, and discount codes.'
    && chatShotState.response.text === 'I’ll scope the checkout feature from the tasklist: create the Stripe integration, wire receipt emails, add the discount engine, and prepare the creator payout stub.'
    && chatViewForFrame(270).prompt === chatShotState.prompt.text
    // Response streams in at the agent cadence (~90 char/s), completing ~362.
    && chatViewForFrame(362).response === chatShotState.response.text;
}

function chatToolAndPlanScopePass() {
  const planMessage = chatShotViewForFrame(390).conversation.additionalAssistantMessages?.[0];
  const planMarkdown = planMessage?.markdownBlock?.content ?? '';
  const toolSummaries = chatToolActivity.entries.map(entry => entry.summary);

  return chatToolActivity.entries.length === 4
    && toolSummaries[0] === 'notes/supafan/tasklist/current.md'
    && toolSummaries[1] === 'create implementation tickets from checkout scope'
    && toolSummaries[2] === 'packages/api/src/services/checkout-service.ts'
    && toolSummaries[3] === 'npm run typecheck'
    && launchPlanArtifact.title === 'Checkout Implementation Plan'
    && launchPlanArtifact.content.steps?.map(step => step.title).join('|') === 'Design payment flow|Create tickets|Wire Stripe integration|Review deploy checklist'
    && planMarkdown.includes('Supafan Checkout -> Implementation Pass')
    && planMarkdown.includes('Stripe checkout sessions')
    && planMarkdown.includes('receipt emails')
    && planMarkdown.includes('discount codes')
    && planMarkdown.includes('packages/api/src/services/checkout-service.ts');
}

function persistentCursorTimelinePass() {
  const targets = {
    approve: percentTarget(10, 20, 4, 4),
    recent: percentTarget(70, 20, 4, 4),
  };
  const held = cursorTimeline(targets, [
    {start: 10, end: 20, from: 'approve', to: 'approve'},
    {start: 40, end: 50, from: 'approve', to: 'recent'},
  ], 30, 'percent');

  return held?.fade === false
    && held.click === false
    && held.from[0] === held.to[0]
    && held.from[1] === held.to[1];
}

function notesNewNoteCursorTargetPass() {
  const width = 1920;
  const target = notesHomeNewNoteButtonTarget({
    windowStyle: {
      left: 32,
      top: 32,
      width: width - 64,
    },
  }, width);
  const clickPoint = {
    x: target.left + target.width * 0.52,
    y: target.top + target.height * 0.5,
  };
  return target.width >= 100
    && target.height >= 32
    && clickPoint.x > target.left
    && clickPoint.x < target.left + target.width
    && clickPoint.y > target.top
    && clickPoint.y < target.top + target.height
    && target.left < width * 0.74;
}

function calendarMonthStoryboardPass() {
  const story = launchFilmStory.calendar;
  const view = calendarViewForFrame(0);
  const cells = view.month?.cells ?? [];
  // Index n is June n for n in 1..30 (index 0 is May 31).
  return view.view === 'month'
    && view.headerLabel === story.monthLabel
    && cells.length === 42
    && cells[27]?.isToday === true
    && cells[story.seededEvents.deployChecklist.day]?.chips[0]?.title === story.seededEvents.deployChecklist.title
    && cells[story.seededEvents.betaFreeze.day]?.chips[0]?.allDay === true
    && cells[story.seededEvents.betaFreeze.day]?.chips[0]?.title === story.seededEvents.betaFreeze.title
    && cells[story.seededEvents.stripeReview.day]?.chips[0]?.time === story.seededEvents.stripeReview.time;
}

function calendarDayOpenPass() {
  const story = launchFilmStory.calendar;
  const before = calendarViewForFrame(calendarBeats.dayOpen - 1);
  const after = calendarViewForFrame(calendarBeats.dayOpen);
  return before.view === 'month'
    && after.view === 'day'
    && after.headerLabel === story.dayLabel
    && calendarBreadcrumbsForFrame(calendarBeats.dayOpen - 1).join('/') === 'Calendar'
    && calendarBreadcrumbsForFrame(calendarBeats.dayOpen).join('/') === `Calendar/${story.dayBreadcrumb}`
    && (after.day?.nowLineTopPx ?? null) !== null;
}

function calendarDialogToBlockPass() {
  const story = launchFilmStory.calendar;
  const typingStartView = calendarViewForFrame(calendarBeats.typingStart);
  const typedView = calendarViewForFrame(calendarBeats.typingEnd);
  const savedView = calendarViewForFrame(calendarBeats.blockInDone);
  const block = savedView.day?.blocks[0];
  return typingStartView.dialog?.title === ''
    && typingStartView.day?.blocks.length === 0
    && typedView.dialog?.title === story.launchEvent.title
    && savedView.dialog == null
    && block?.title === story.launchEvent.title
    && block.timeLabel === story.launchEvent.timeLabel
    && block.topPx === 480; // 10 AM at 48px per hour
}

function calendarDayNumberCursorTargetPass() {
  const width = 1440;
  const height = 900;
  const target = calendarDayNumberTarget({
    windowStyle: {
      left: 32,
      top: 32,
      width: width - 64,
      height: height - 64,
    },
  }, width, height);
  const clickPoint = {
    x: target.left + target.width * 0.5,
    y: target.top + target.height * 0.5,
  };
  return target.width >= 20
    && target.height >= 16
    && clickPoint.x > target.left
    && clickPoint.x < target.left + target.width
    && clickPoint.y > target.top
    && clickPoint.y < target.top + target.height
    // Saturday column sits at the right edge of the grid.
    && target.left > width * 0.8;
}

function boardStoryboardContinuityPass() {
  const tabs = boardShotState.dashboard.tabs;
  const stripeTab = tabs.find(tab => tab.id === launchFilmStory.threads.stripePaymentIntegration.id);
  const deployTab = tabs.find(tab => tab.id === launchFilmStory.threads.deployChecklist.id);
  const createForm = boardShotState.createForm;
  const backlog = boardShotState.board.columns.find(column => column.title === 'Backlog');
  const inProgress = boardShotState.board.columns.find(column => column.title === 'In Progress');

  return boardShotState.dashboard.activeTabId === launchFilmStory.threads.stripePaymentIntegration.id
    && stripeTab?.pinned === true
    && deployTab?.pinned === true
    && createForm.title === launchFilmStory.threads.addDiscountCodeSupport.title
    && createForm.linkedThreadQuery === launchFilmStory.threads.checkoutImplementation.title
    && createForm.parentThread?.shortCode === launchFilmStory.threads.checkoutImplementation.shortCode
    && backlog?.cards.some(card => card.title === launchFilmStory.threads.addDiscountCodeSupport.title) === true
    && inProgress?.cards.some(card => card.title === 'Wire receipt email templates') === true;
}

function notesStoryboardContinuityPass() {
  const overview = notesEditorViewForFrame(100);
  const receiptTodo = notesEditorViewForFrame(150);

  return overview.breadcrumbs.join(' > ') === 'Notes > Supafan > Tasklist'
    && overview.editor.beforeLines.some(line => line.text === launchFilmStory.threads.addDiscountCodeSupport.title)
    && receiptTodo.breadcrumbs.join(' > ') === 'Notes > Supafan > Tasklist > receipt emails'
    && receiptTodo.taskList.items.some(item => item.id === 'receipt-emails' && item.completed === true)
    && receiptTodo.editor.beforeLines.some(line => line.text === 'Configure Resend transport');
}

function notesHomeStoryboardPass() {
  const home = notesHomeViewForFrame(120);

  return home.greeting === notesHomeState.greeting
    && home.showSearch === true
    && home.showRecent === true
    && home.showFavorites === true
    && home.recent.map(note => note.title).join('|') === 'current|Tasklist|api'
    && home.recent.map(note => note.updatedAt).join('|') === 'just now|4m ago|18m ago'
    && home.favorites.map(note => note.title).join('|') === 'current|Roadmap|Design'
    && home.favorites.map(note => note.updatedAt).join('|') === 'just now|today|yesterday'
    && notesHomeViewForFrame(140).newNotePressed === true;
}

function notesEditorStoryboardPass() {
  // Probe each note after its lines finish typing at the shared cadence:
  // new-note body completes ~frame 71, the overview after-line ~120, the
  // todo completion line ~165.
  const checkoutNote = notesEditorViewForFrame(74);
  const tasklistOverview = notesEditorViewForFrame(120);
  const receiptTodo = notesEditorViewForFrame(150);
  const receiptDone = notesEditorViewForFrame(166);

  return checkoutNote.breadcrumbs.join(' > ') === 'Notes > Supafan > Checkout Notes'
    && checkoutNote.editor.title.text === 'Checkout notes'
    && checkoutNote.editor.beforeLines.map(line => line.text).join('|') === 'Stripe webhook setup|checkout flow in staging|keep tasks nearby'
    && notesRightRailState.items.map(item => item.title).join('|') === 'Supafan|Payments|Tasklist|Design'
    && notesRightRailState.favorites.map(item => item.title).join('|') === 'current|api|Roadmap'
    && notesTaskListItems.map(item => item.title).join('|') === 'Stripe webhooks|current|receipt emails|checkout UI|discount codes|creator payouts|product variants|landing page redesign|pricing tiers|analytics dashboard'
    && tasklistOverview.editor.beforeLines.map(line => line.text).join('|') === `Stripe webhooks|current|receipt emails|${launchFilmStory.threads.addDiscountCodeSupport.title}`
    && tasklistOverview.editor.afterLines[0]?.text === 'Checkout work stays by the note.'
    && receiptTodo.editor.beforeLines.map(line => line.text).join('|') === 'Configure Resend transport|Render order summary template|Keep the linked checkout context visible'
    && receiptDone.editor.afterLines[0]?.text === 'Completed from panel.';
}

function codeStoryboardContinuityPass() {
  const pr = codeShotState.review.pullRequest.createdPr;
  return codeShotState.review.branch === launchFilmStory.branch
    && codeShotState.review.baseDirectory === launchFilmStory.projectPath
    && codeShotState.review.worktrees.some(worktree => worktree.branch === launchFilmStory.branch && worktree.path === launchFilmStory.projectPath && worktree.current)
    && codeShotState.generatedCommitMessage === 'feat(checkout): wire Stripe flow, receipts, and discounts'
    && pr?.number === 42
    && pr.baseBranch === launchFilmStory.baseBranch
    && pr.headBranch === launchFilmStory.branch
    && pr.url.includes(launchFilmStory.repo)
    && codeShotState.review.pullRequest.changedFiles.some(file => file.path === 'packages/api/src/services/discount-service.ts');
}

function codePrMergeAndTerminalPass() {
  const terminalView = codeShotViewForFrame(240);
  const mergedView = codeReviewViewForFrame(406);
  const terminalOutput = terminalView.review.state.terminal.output ?? '';

  return terminalView.review.state.terminal.expanded === true
    && terminalOutput.includes('npm test -- --filter checkout')
    && terminalOutput.includes('checkout-service.test.ts (4 tests)')
    && terminalOutput.includes('All tests passed')
    && mergedView.pullRequest.createdPr?.number === 42
    && mergedView.pullRequest.createdPr.state === 'MERGED'
    && mergedView.pullRequest.createdPr.mergeStateStatus === 'CLEAN'
    && mergedView.pullRequest.createdPr.reviewDecision === 'APPROVED';
}

function codeWorktreeAndStashFlowPass() {
  const beforeSwitch = codeShotViewForFrame(120).review.state;
  const switching = codeShotViewForFrame(160).review.state;
  const afterCommit = codeShotViewForFrame(220).review.state;

  return beforeSwitch.branch === launchFilmStory.branch
    && (beforeSwitch.stashes?.length ?? 0) === 0
    && switching.branch === launchFilmStory.baseBranch
    && switching.worktrees.some(worktree => worktree.branch === launchFilmStory.baseBranch && worktree.current)
    && switching.stashes?.some(stash => stash.message === `WIP on ${launchFilmStory.branch}: incomplete work`) === true
    && afterCommit.branch === launchFilmStory.branch
    && afterCommit.commits[0]?.title === codeShotState.generatedCommitMessage;
}

function workflowMontageContinuityPass() {
  const workflow = workflowStateForFrame(workflowBeats.settle.to - 4);
  const montageConversation = montageShotViewForFrame(60);
  const montageLogs = montageShotViewForFrame(120);
  const montageDatabase = montageShotViewForFrame(220);

  return workflow.nodes.some(node => node.id === 'switch' && node.label === launchFilmStory.flow.switchLabel)
    && workflow.nodes.some(node => node.id === 'run-migrations' && node.label === launchFilmStory.flow.actionLabels.migrations)
    && workflow.nodes.some(node => node.id === 'notify-releases' && node.label === launchFilmStory.flow.actionLabels.notify)
    && montageConversation.surface === 'conversation'
    && montageConversation.conversation.userMessage === launchFilmStory.command
    && montageConversation.conversation.assistantMarkdown.includes('notified the #releases channel')
    && montageLogs.surface === 'logs'
    && montageLogs.logs.logs.some(log => JSON.stringify(log).includes(launchFilmStory.command))
    && montageDatabase.surface === 'database'
    && JSON.stringify(montageDatabase.database).includes('deploy-checkout');
}

function chapterCopyMatchesStoryboardPass() {
  const expectedChapters = [
    ['intro-title', 'AgentBuddy is...', undefined],
    ['chat-title', 'More than just an AI chat', undefined],
    ['notes-title', 'More than just a note taker', undefined],
    ['code-title', 'More than just an IDE', undefined],
    ['workflow-title', 'More than just a workflow engine', undefined],
    ['calendar-title', 'More than just a calendar', undefined],
  ] as const;

  // The revolution lockup copy appears exactly once, in the final shot
  // (pinned by the final-lockup check) — no duplicate montage title card.
  const lockupCopyHeldOnce = !shots.some(shot => shot.id === 'montage-title')
    && finalShotState.title === 'AgentBuddy is a revolution';

  return lockupCopyHeldOnce && expectedChapters.every(([id, title, subtitle]) => {
    const chapter = shots.find(shot => shot.id === id)?.chapter;
    return chapter?.title === title && chapter.subtitle === subtitle;
  });
}

function montageStoryboardSequencePass() {
  const sequence = [
    montageShotViewForFrame(0),
    montageShotViewForFrame(90),
    montageShotViewForFrame(180),
    montageShotViewForFrame(300),
  ];

  return sequence[0].surface === 'conversation'
    && sequence[0].activePlugin === 'threads'
    && sequence[1].surface === 'logs'
    && sequence[1].activePlugin === 'logs'
    && sequence[2].surface === 'database'
    && sequence[2].activePlugin === 'database'
    && sequence[3].surface === 'browser'
    && sequence[3].activePlugin === 'browser'
    && !sequence.some(view => view.activePlugin === 'settings');
}

function browserMontageActionPass() {
  const typing = montageShotViewForFrame(276);
  const loading = montageShotViewForFrame(294);
  const loaded = montageShotViewForFrame(312);

  return typing.surface === 'browser'
    && loading.surface === 'browser'
    && loaded.surface === 'browser'
    && typing.browser.addressFocused === true
    && typing.browser.suggestions?.[0]?.title === 'Supafan Checkout'
    && loading.browser.tabs.find(tab => tab.id === 3)?.isLoading === true
    && loaded.browser.addressFocused === false
    && loaded.browser.addressBarValue === 'https://supafan.app/checkout'
    && loaded.browser.tabs.find(tab => tab.id === 3)?.title === 'Supafan Checkout';
}

function shotDurationsMatchCutsPass() {
  const contentShotIds: ContentShotId[] = ['chat', 'board', 'notes', 'code', 'workflow', 'calendar', 'montage', 'final'];
  return contentShotIds.every(id => {
    const duration = shots.find(shot => shot.id === id)?.duration;
    const removed = (shotCuts[id] ?? []).reduce((sum, cut) => sum + cut.remove, 0);
    return duration === shotSourceDurations[id] - removed;
  });
}

function frameCutsWellFormedPass() {
  return Object.entries(shotCuts).every(([id, cuts]) => {
    const sorted = cuts.every((cut, index) => cut.remove > 0
      && (index === 0 || cuts[index - 1].at + cuts[index - 1].remove <= cut.at));
    const duration = shots.find(shot => shot.id === id)?.duration ?? 0;
    const sourceDuration = shotSourceDurations[id as ContentShotId];
    let monotonic = true;
    let previous = -1;
    for (let frame = 0; frame < duration; frame += 1) {
      const source = cutFrames(frame, cuts);
      if (source <= previous || source >= sourceDuration) monotonic = false;
      previous = source;
    }
    return sorted && monotonic && cutFrames(duration - 1, cuts) === sourceDuration - 1;
  });
}

function montageDissolveIntegrityPass() {
  const cuts = shotCuts.montage ?? [];
  const clearOfWindows = cuts.every(cut => montageSegmentBoundaries.every(boundary =>
    cut.at + cut.remove <= boundary - 4 || cut.at >= boundary + montageDissolveFrames + 2,
  ));
  const dissolvesSwapContent = montageSegmentBoundaries.every(boundary => {
    const outgoing = montageShotViewForFrame(boundary - 1);
    const incoming = montageShotViewForFrame(boundary + montageDissolveFrames);
    return JSON.stringify(outgoing) !== JSON.stringify(incoming);
  });
  return clearOfWindows && dissolvesSwapContent;
}

const flowCanvasCss = readFileSync(new URL('../src/agentbuddy-ui/flows/FlowCanvas.module.css', import.meta.url), 'utf8');
const flowEdgeSource = readFileSync(new URL('../src/agentbuddy-ui/flows/FlowEdge.tsx', import.meta.url), 'utf8');
const workflowSource = readFileSync(new URL('../src/film/state/workflow.ts', import.meta.url), 'utf8');
const workflowShotSource = readFileSync(new URL('../src/film/shots/WorkflowShot.tsx', import.meta.url), 'utf8');

const checks: Check[] = [
  {
    area: 'final',
    message: 'visible chapter copy matches storyboard source of truth',
    pass: chapterCopyMatchesStoryboardPass(),
  },
  {
    area: 'notes',
    message: 'notes shot types new note title',
    pass: notesEditorViewForFrame(0).editor.title.text !== notesEditorViewForFrame(30).editor.title.text,
  },
  {
    area: 'notes',
    message: 'notes shot types checkout note lines',
    pass: notesEditorViewForFrame(12).editor.beforeLines[0].text !== notesEditorViewForFrame(40).editor.beforeLines[0].text
      && notesEditorViewForFrame(30).editor.beforeLines[1].text !== notesEditorViewForFrame(58).editor.beforeLines[1].text,
  },
  {
    area: 'notes',
    message: 'notes home shows storyboard recent and favorite notes',
    pass: notesHomeStoryboardPass(),
  },
  {
    area: 'notes',
    message: 'notes editor, right rail, and tasklist match storyboard copy',
    pass: notesEditorStoryboardPass(),
  },
  {
    area: 'notes',
    message: 'notes shot transitions from new note to tasklist overview',
    pass: notesEditorViewForFrame(70).breadcrumbs.join('/') !== notesEditorViewForFrame(100).breadcrumbs.join('/'),
  },
  {
    area: 'notes',
    message: 'notes new note cursor target lands inside button geometry',
    pass: notesNewNoteCursorTargetPass(),
  },
  {
    area: 'chat',
    message: 'chat shot types user prompt',
    pass: chatViewForFrame(0).prompt !== chatViewForFrame(92).prompt,
  },
  {
    area: 'chat',
    message: 'chat prompt and response match Supafan checkout storyboard',
    pass: chatStoryboardContentPass(),
  },
  {
    area: 'chat',
    message: 'chat reference autocomplete pauses on Tasklist before continuing',
    pass: chatTasklistReferenceSelectionPass(),
  },
  {
    area: 'chat',
    message: 'chat image attachment is a Supafan checkout mockup',
    pass: chatAttachmentMatchesStoryboardPass(),
  },
  {
    area: 'chat',
    message: 'chat approved summary appears after a short delay',
    pass: chatApprovedSummaryDelayPass(),
  },
  {
    area: 'chat',
    message: 'chat tool activity and plan artifact preserve checkout scope',
    pass: chatToolAndPlanScopePass(),
  },
  {
    area: 'chat',
    message: 'chat shot reveals assistant response',
    pass: chatViewForFrame(306).response !== chatViewForFrame(346).response,
  },
  {
    area: 'chat',
    message: 'chat tool activity reveals rows sequentially',
    pass: toolActivityViewForFrame(234).rowOpacities[0] !== toolActivityViewForFrame(250).rowOpacities[0]
      && toolActivityViewForFrame(276).rowOpacities[3] !== toolActivityViewForFrame(292).rowOpacities[3],
  },
  {
    area: 'chat',
    message: 'chat tool activity transitions from streaming to done',
    pass: toolActivityViewForFrame(290).state.state === 'streaming'
      && toolActivityViewForFrame(291).state.state === 'done',
  },
  {
    area: 'board',
    message: 'board dashboard and create form match storyboard continuity',
    pass: boardStoryboardContinuityPass(),
  },
  {
    area: 'board',
    message: 'board shot moves card horizontally',
    pass: boardViewForFrame(330).movingCardStyle.left !== boardViewForFrame(362).movingCardStyle.left,
  },
  {
    area: 'board',
    message: 'board shot moves card vertically',
    pass: boardViewForFrame(330).movingCardStyle.top !== boardViewForFrame(362).movingCardStyle.top,
  },
  {
    area: 'board',
    message: 'board shot rotates moving card',
    pass: boardViewForFrame(330).movingCardStyle.transform !== boardViewForFrame(362).movingCardStyle.transform,
  },
  {
    area: 'code',
    message: 'code branch, PR, files, and repo match storyboard continuity',
    pass: codeStoryboardContinuityPass(),
  },
  {
    area: 'code',
    message: 'code shot shows checkout tests and merges PR cleanly',
    pass: codePrMergeAndTerminalPass(),
  },
  {
    area: 'code',
    message: 'code shot stashes incomplete work and switches worktrees before commit',
    pass: codeWorktreeAndStashFlowPass(),
  },
  {
    area: 'code',
    message: 'code shot reveals diff changes line by line',
    pass: changed(codeReviewViewForFrame(20).diffLineOpacities, codeReviewViewForFrame(120).diffLineOpacities),
  },
  {
    area: 'code',
    message: 'code shot generates commit message',
    pass: codeReviewViewForFrame(142).commitMessage === ''
      && codeReviewViewForFrame(208).commitMessage === codeShotState.generatedCommitMessage,
  },
  {
    area: 'code',
    message: 'code shot switches from commit panel to PR panel',
    pass: codeReviewViewForFrame(96).activePanel === 'commit'
      && codeReviewViewForFrame(317).activePanel === 'pr',
  },
  {
    area: 'code',
    message: 'code shot publishes branch before PR creation',
    pass: codeReviewViewForFrame(318).prPublishProgress === 0
      && codeReviewViewForFrame(350).prPublishProgress === 1,
  },
  {
    area: 'code',
    message: 'code shot progresses through PR files, create, and details modes',
    pass: codeReviewViewForFrame(350).prMode === 'files'
      && codeReviewViewForFrame(380).prMode === 'create'
      && codeReviewViewForFrame(381).prMode === 'details'
      && Boolean(codeReviewViewForFrame(381).pullRequest.createdPr),
  },
  {
    area: 'workflow',
    message: 'workflow and montage command continuity matches storyboard',
    pass: workflowMontageContinuityPass(),
  },
  {
    area: 'workflow',
    message: 'montage sequence stays threads to logs to database to browser without settings',
    pass: montageStoryboardSequencePass(),
  },
  {
    area: 'browser',
    message: 'browser montage types URL, shows autocomplete, loads checkout tab',
    pass: browserMontageActionPass(),
  },
  {
    area: 'notes',
    message: 'notes tasklist continuity matches board-created discount thread and receipt todo',
    pass: notesStoryboardContinuityPass(),
  },
  {
    area: 'workflow',
    message: 'workflow shot reveals blueprint nodes and edges',
    pass: workflowStateForFrame(0).nodes.length !== workflowStateForFrame(workflowBeats.settle.to - 4).nodes.length
      && workflowStateForFrame(0).edges.length !== workflowStateForFrame(workflowBeats.settle.to - 4).edges.length,
  },
  {
    area: 'workflow',
    message: 'workflow shot stays blueprint-only without runtime status or animated node selection',
    pass: workflowStateForFrame(130).selectedNodeId == null
      && workflowStateForFrame(130).editingNodeId == null
      && !JSON.stringify(workflowStateForFrame(workflowBeats.settle.to - 4)).includes('"status"'),
  },
  {
    area: 'workflow',
    message: 'flow execution edges use renderer-style CSS dash animation',
    pass: flowCanvasCss.includes('stroke-dasharray: 5 5')
      && flowCanvasCss.includes('@keyframes FlowCanvas_dashFlow')
      && flowCanvasCss.includes('stroke-dashoffset: -10')
      && !flowEdgeSource.includes('strokeDashoffset')
      && !workflowSource.includes('edgeDashOffset'),
  },
  {
    area: 'workflow',
    message: 'workflow intro uses real FlowCanvas geometry without duplicate straight-edge overlay',
    pass: workflowShotSource.includes('<FlowCanvas backgroundOpacity={backdropReveal} state={view.flow} />')
      && !workflowShotSource.includes('isolatedEdge')
      && !workflowShotSource.includes('appRevealClip')
      && !workflowShotSource.includes('clipPath'),
  },
  {
    area: 'workflow',
    message: 'workflow palette overlays without moving canvas viewport',
    pass: workflowStateForFrame(150).viewport == null
      && workflowStateForFrame(workflowBeats.settle.to - 4).viewport == null
      && workflowStateForFrame(workflowBeats.palette.from).chrome?.paletteStyle?.opacity === 0
      && Number(workflowStateForFrame(workflowBeats.palette.from + 1).chrome?.paletteStyle?.opacity) > 0
      && Number(workflowStateForFrame(Math.round((workflowBeats.palette.from + workflowBeats.palette.to) / 2)).chrome?.paletteStyle?.opacity) > 0
      && !String(workflowStateForFrame(200).chrome?.paletteStyle?.width ?? '').includes('px'),
  },
  {
    area: 'chat',
    message: 'cursor fades in and out around path boundaries',
    pass: cursorOpacityForFrame(18, 18, 38) === 0
      && cursorOpacityForFrame(28, 18, 38) > 0.95
      && cursorOpacityForFrame(38, 18, 38) === 0,
  },
  {
    area: 'chat',
    message: 'cursor timeline persists location between actions',
    pass: persistentCursorTimelinePass(),
  },
  {
    area: 'calendar',
    message: 'calendar month view matches storyboard seeded events with today on launch day',
    pass: calendarMonthStoryboardPass(),
  },
  {
    area: 'calendar',
    message: 'calendar day-number click swaps month grid for the launch-day timeline and breadcrumb',
    pass: calendarDayOpenPass(),
  },
  {
    area: 'calendar',
    message: 'calendar dialog types the launch event title and saves it into the 10 AM block',
    pass: calendarDialogToBlockPass(),
  },
  {
    area: 'calendar',
    message: 'calendar day-number cursor target lands inside the pill geometry',
    pass: calendarDayNumberCursorTargetPass(),
  },
  {
    area: 'final',
    message: 'final lockup uses canonical revolution copy',
    pass: finalShotState.title === 'AgentBuddy is a revolution'
      && finalShotState.subtitle === 'to put the full power of AI into the hands of the people',
  },
  {
    area: 'final',
    message: 'final shot animates title',
    pass: finalViewForFrame(0).titleStyle.opacity !== finalViewForFrame(80).titleStyle.opacity,
  },
  {
    area: 'final',
    message: 'final shot animates subtitle',
    pass: finalViewForFrame(0).subtitleStyle.opacity !== finalViewForFrame(100).subtitleStyle.opacity,
  },
  {
    area: 'final',
    message: 'every shot duration equals its source duration minus its edit cuts',
    pass: shotDurationsMatchCutsPass(),
  },
  {
    area: 'final',
    message: 'frame cuts are monotonic, endpoint-exact, and sorted',
    pass: frameCutsWellFormedPass(),
  },
  {
    area: 'workflow',
    message: 'no montage cut intersects a dissolve window and dissolves swap surfaces',
    pass: montageDissolveIntegrityPass(),
  },
];

const failed = checks.filter(check => !check.pass);
const minimumMoments = 10;
const minimumProductMoments = 10;
const requiredProductAreas = new Set<ProductArea>(['board', 'browser', 'calendar', 'chat', 'code', 'notes', 'workflow']);
const productChecks = checks.filter(check => check.area !== 'final');
const coveredProductAreas = new Set(productChecks.map(check => check.area));
const missingProductAreas = [...requiredProductAreas].filter(area => !coveredProductAreas.has(area));

if (failed.length > 0) {
  throw new Error(`Film action audit failed:\n${failed.map(check => `- ${check.message}`).join('\n')}`);
}

if (checks.length < minimumMoments) {
  throw new Error(`Film action audit must prove at least ${minimumMoments} frame-driven moments; only ${checks.length} checks exist.`);
}

if (productChecks.length < minimumProductMoments) {
  throw new Error(`Film action audit must prove at least ${minimumProductMoments} product-surface moments before the final lockup; only ${productChecks.length} checks exist.`);
}

if (missingProductAreas.length > 0) {
  throw new Error(`Film action audit must cover every product surface area; missing ${missingProductAreas.join(', ')}.`);
}

console.log(`Film action audit passed: ${checks.length} frame-driven shot checks across ${coveredProductAreas.size} product areas.`);
