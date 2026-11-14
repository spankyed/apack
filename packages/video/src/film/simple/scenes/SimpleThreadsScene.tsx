import {AppWindow} from '../../../agentbuddy-ui/chrome/AppWindow';
import {ChatComposer} from '../../../agentbuddy-ui/chat/ChatComposer';
import type {ChatComposerInlineNode} from '../../../agentbuddy-ui/chat/chatTypes';
import {EmptyThreadQuote} from '../../../agentbuddy-ui/threads/EmptyThreadQuote';
import {ReferencePill} from '../../../agentbuddy-ui/chat/ReferencePill';
import {ThreadConversation} from '../../../agentbuddy-ui/threads/ThreadConversation';
import {ThreadDashboardSurface} from '../../../agentbuddy-ui/threads/ThreadDashboardSurface';
import {ThreadCreateForm} from '../../../agentbuddy-ui/threads/ThreadCreateForm';
import {ThreadsBoardSurface} from '../../../agentbuddy-ui/threads/ThreadsBoardSurface';
import {TextCaret} from '../../../agentbuddy-ui/primitives/TextCaret';
import {Cursor} from '../../overlays/Cursor';
import {chatInteractionScript, chatShotViewForFrame, type ChatPointer, type ChatTargetId} from '../../state/chat';
import {createInteractionModel, type InteractionStep} from '../../interaction/interactionTimeline';
import {boardChromeTargets, boardDragTargets, boardInteractions, boardShotViewForFrame, type BoardTargetId} from '../../state/board';
import {useAppWindowLayout} from '../../appWindowLayout';
import {ease, mix} from '../../state/timeline';
import type {CursorPath, TargetRect} from '../../interaction/cursorTargets';
import {threadsBoardSourceStart} from '../timeline';
import {useVideoConfig} from 'remotion';
import '../../shots/ChatShot.module.css';
import '../../shots/BoardShot.module.css';
import {makeStyles} from '../../../agentbuddy-ui/primitives/makeStyles';

const chatStyles = makeStyles('ChatShot');
const boardStyles = makeStyles('BoardShot');
const bottomTabsHeight = 38;
const composerInputHeight = 112;
const composerEditorInsetLeft = 16;
const composerEditorInsetTop = 12;
const referencePopupAboveCursorOffset = 4;

// The cursor for the threads scene is the shared chat interaction script
// (the single source of truth that also drives every composer state) plus
// the simple-film-only breadcrumb navigation that joins chat -> board.
const threadsBreadcrumbStep: InteractionStep<ChatTargetId> = {
  label: 'nav-board', start: 630, end: 648, to: 'threadsBreadcrumb', from: 'quickPromptSend',
};
const threadsCursorModel = createInteractionModel<ChatTargetId>([...chatInteractionScript, threadsBreadcrumbStep]);

// One long threads-chapter scene: the chat story plays in the docked
// composer, then the cursor clicks the Threads breadcrumb and the surface
// switches to the dashboard -> create form -> kanban story instantly at each
// real button click. No fades anywhere; the full app frame never moves.
export function SimpleThreadsScene({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  if (frame < threadsBoardSourceStart) {
    return <ThreadsChatPhase frame={frame} variant={variant} />;
  }
  return <ThreadsBoardPhase frame={frame - threadsBoardSourceStart} variant={variant} />;
}

function ThreadsChatPhase({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const layout = useAppWindowLayout({animate: false, variant});
  const {height, width} = useVideoConfig();
  const composerRect = composerPlacement({height, layout, variant, width});
  const targets = chatTargetsForFrame({composerRect, height, layout, variant, width});
  // Press/hover derive from the real cursor sprite over the real target rects.
  const pointer = chatPointerForFrame(frame, targets, width, height);
  const view = chatShotViewForFrame(frame, pointer);
  const composer = withPopupPositions(view.composer, composerRect, height);
  const cursorPath = chatCursorForFrame(frame, targets, width, height);
  const quote = emptyThreadQuoteForFrame(frame, layout, variant);

  return (
    <div className={chatStyles.root}>
      <div className={chatStyles.appReveal}>
        <AppWindow activePlugin="threads" breadcrumbs={view.breadcrumbs} composer={false} layout={layout}>
          <div style={{height: '100%', ...view.conversationStyle}}>
            <ThreadConversation
              align="bottom"
              additionalAssistantMessages={view.conversation.additionalAssistantMessages}
              assistant={view.conversation.assistant}
              createdAt={view.conversation.createdAt}
              messageStyles={view.messageStyles}
              queuedMessage={view.conversation.queuedMessage ? (
                <div className={`${chatStyles.viewerWrapper} tiptap-wrapper tiptap-viewer tiptap-viewer-chat`}>
                  <div className={`${chatStyles.viewerProse} ProseMirror`} contentEditable={false}>
                    <p>{view.conversation.queuedMessage.text}</p>
                  </div>
                </div>
              ) : undefined}
              systemMessage={view.conversation.systemMessage}
              userMessage={
                <div className={`${chatStyles.viewerWrapper} tiptap-wrapper tiptap-viewer tiptap-viewer-chat`}>
                  <div className={`${chatStyles.viewerProse} ProseMirror`} contentEditable={false}>
                    <p>
                      {formatUserMessage(view.conversation.userMessage.text, view.conversation.userMessage.content)}
                      <TextCaret frame={frame} visible={view.conversation.userMessage.caretVisible} />
                    </p>
                  </div>
                </div>
              }
            >
            </ThreadConversation>
          </div>
        </AppWindow>
      </div>
      <div
        className={chatStyles.composerMotion}
        style={{
          left: composerRect.left,
          top: composerRect.top,
          width: composerRect.width,
          transform: 'translate(-50%, -100%)',
        }}
      >
        <ChatComposer formStyle={{width: '100%'}} state={composer} />
      </div>
      {quote ? <EmptyThreadQuote style={quote.style} text={quote.text} /> : null}
      {cursorPath ? <Cursor frame={frame} {...cursorPath} /> : null}
    </div>
  );
}

function ThreadsBoardPhase({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const view = boardShotViewForFrame(frame);
  const layout = useAppWindowLayout({animate: false, variant});
  const {height, width} = useVideoConfig();
  const cursor = boardCursorForFrame(frame, windowBoxFromLayout(layout, width, height), width, height);

  return (
    <div className={boardStyles.root}>
      <div className={boardStyles.appReveal}>
        <AppWindow activePlugin="threads" breadcrumbs={view.breadcrumbs} composer={false} layout={layout}>
          {!view.dashboard && (frame >= 150 || !view.createForm) ? (
            <div className={boardStyles.surfaceReveal}>
              <ThreadsBoardSurface
                board={view.board}
                header={view.header}
                movingCard={view.movingCard}
              />
            </div>
          ) : null}
          {view.dashboard ? (
            <div className={boardStyles.surfaceReveal}>
              <ThreadDashboardSurface state={view.dashboard} />
            </div>
          ) : null}
          {view.createForm ? (
            <div className={boardStyles.surfaceReveal}>
              <ThreadCreateForm state={view.createForm} />
            </div>
          ) : null}
        </AppWindow>
      </div>
      {cursor ? <Cursor frame={frame} {...cursor} /> : null}
    </div>
  );
}

function withPopupPositions(
  composer: ReturnType<typeof chatShotViewForFrame>['composer'],
  rect: ReturnType<typeof composerPlacement>,
  viewportHeight: number,
) {
  const bottomTabsRect = bottomTabsPlacement(rect, viewportHeight);
  const newThreadMenu = composer.bottomTabs?.newThreadMenu
    ? {
        ...composer.bottomTabs.newThreadMenu,
        popupPosition: composer.bottomTabs.newThreadMenu.popupPosition ?? newThreadMenuPlacement(bottomTabsRect),
      }
    : undefined;
  const referenceAutocomplete = composer.referenceAutocomplete
    ? {
        ...composer.referenceAutocomplete,
        popupPosition: composer.referenceAutocomplete.popupPosition ?? referencePopupPlacement(
          composer.referenceAutocomplete.anchorCharacterIndex,
          textBeforeAnchor(composer, composer.referenceAutocomplete.anchorCharacterIndex),
          Boolean(composer.bottomTabs),
          rect,
          viewportHeight,
        ),
      }
    : undefined;
  const commandSuggestion = composer.commandSuggestion
    ? {
        ...composer.commandSuggestion,
        popupPosition: composer.commandSuggestion.popupPosition ?? commandSuggestionPopupPlacement(
          composer.commandSuggestion.anchorCharacterIndex ?? 0,
          textBeforeAnchor(composer, composer.commandSuggestion.anchorCharacterIndex ?? 0),
          Boolean(composer.bottomTabs),
          rect,
          viewportHeight,
        ),
      }
    : undefined;
  const revertHistory = composer.revertHistory
    ? {
        ...composer.revertHistory,
        popupPosition: composer.revertHistory.popupPosition ?? revertHistoryPopupPlacement(
          rect,
          Boolean(composer.bottomTabs),
          viewportHeight,
        ),
      }
    : undefined;

  return {
    ...composer,
    commandSuggestion,
    referenceAutocomplete,
    revertHistory,
    bottomTabs: composer.bottomTabs
      ? {
          ...composer.bottomTabs,
          newThreadMenu,
          recentThreadsMenu: composer.bottomTabs.recentThreadsMenu
            ? {
                ...composer.bottomTabs.recentThreadsMenu,
                popupPosition: composer.bottomTabs.recentThreadsMenu.popupPosition ?? {
                  bottom: viewportHeight - (composerInputTop(rect, Boolean(composer.bottomTabs)) + composerInputHeight - 12),
                  left: bottomTabsRect.left,
                  width: bottomTabsRect.width,
                },
              }
            : undefined,
        }
      : undefined,
  };
}

function commandSuggestionPopupPlacement(
  anchorCharacterIndex: number,
  anchorText: string,
  hasBottomTabs: boolean,
  rect: ReturnType<typeof composerPlacement>,
  viewportHeight: number,
) {
  const composerLeft = rect.left - rect.width / 2;
  const composerTop = composerInputTop(rect, hasBottomTabs);
  const clampedAnchor = Math.min(Math.max(anchorCharacterIndex, 0), 36);
  return {
    bottom: viewportHeight - (composerTop + composerEditorInsetTop) + 4,
    left: composerLeft + composerEditorInsetLeft + estimatedInlineTextWidth(anchorText, clampedAnchor),
  };
}

function revertHistoryPopupPlacement(
  rect: ReturnType<typeof composerPlacement>,
  hasBottomTabs: boolean,
  viewportHeight: number,
) {
  const composerLeft = rect.left - rect.width / 2;
  const composerTop = composerInputTop(rect, hasBottomTabs);
  return {
    bottom: viewportHeight - composerTop + 6,
    left: composerLeft,
    maxWidth: Math.max(260, Math.min(rect.width, 520)),
  };
}

function newThreadMenuPlacement(rect: ReturnType<typeof bottomTabsPlacement>) {
  return {
    bottom: rect.bottom + 8,
    left: rect.left + rect.width - 184,
    top: rect.top - 90,
  };
}

function referencePopupPlacement(
  anchorCharacterIndex: number,
  anchorText: string,
  hasBottomTabs: boolean,
  rect: ReturnType<typeof composerPlacement>,
  viewportHeight: number,
) {
  const composerLeft = rect.left - rect.width / 2;
  const composerTop = composerInputTop(rect, hasBottomTabs);
  const clampedAnchor = Math.min(Math.max(anchorCharacterIndex, 0), 36);
  return {
    bottom: viewportHeight - (composerTop + composerEditorInsetTop) + referencePopupAboveCursorOffset,
    left: composerLeft + composerEditorInsetLeft + estimatedInlineTextWidth(anchorText, clampedAnchor),
  };
}

function textBeforeAnchor(
  composer: ReturnType<typeof chatShotViewForFrame>['composer'],
  anchorCharacterIndex: number,
) {
  return composer.text?.slice(0, anchorCharacterIndex) ?? '';
}

function estimatedInlineTextWidth(text: string, fallbackCharacters: number) {
  if (!text) return fallbackCharacters * 7.3;
  return text.split('').reduce((width, character) => {
    if (character === ' ') return width + 3.9;
    if ('il.,:;!|'.includes(character)) return width + 3.8;
    if ('mwMW@#'.includes(character)) return width + 12;
    if (/[A-Z]/.test(character)) return width + 9.2;
    if (/[0-9]/.test(character)) return width + 8;
    return width + 7.3;
  }, 0);
}

function composerInputTop(
  rect: ReturnType<typeof composerPlacement>,
  hasBottomTabs: boolean,
) {
  const composerHeight = composerInputHeight + (hasBottomTabs ? bottomTabsHeight : 0);
  return rect.top - composerHeight;
}

function bottomTabsPlacement(rect: ReturnType<typeof composerPlacement>, viewportHeight: number) {
  const width = rect.width * 0.8;
  const top = rect.top - bottomTabsHeight;
  return {
    left: rect.left - width / 2,
    bottom: viewportHeight - top,
    top,
    width,
  };
}

function formatUserMessage(
  text: string,
  content: ChatComposerInlineNode[] | undefined,
) {
  if (!content?.length) return <>{text}</>;
  return (
    <>
      {content.map((node, index) => {
        if (node.type === 'text') return <span key={`text-${index}`}>{node.text}</span>;
        return <ReferencePill key={node.refId} label={node.label} refType={node.refType} />;
      })}
    </>
  );
}

function chatCursorForFrame(frame: number, targets: Record<ChatTargetId, TargetRect>, width: number, height: number): CursorPath | null {
  return threadsCursorModel.path(targets, frame, {height, width});
}

// The geometric pointer: hover/press answered from where the cursor sprite
// actually is over these exact rects — the same source as the rendered cursor.
function chatPointerForFrame(frame: number, targets: Record<ChatTargetId, TargetRect>, width: number, height: number): ChatPointer {
  const geo = {frame, space: 'px' as const, targets, viewport: {height, width}};
  return {
    over: (target: ChatTargetId) => threadsCursorModel.over(target, geo),
    pressing: (target: ChatTargetId) => threadsCursorModel.pressing(target, frame),
  };
}

function chatTargetsForFrame({
  composerRect,
  height,
  layout,
  variant,
  width,
}: {
  composerRect: ReturnType<typeof composerPlacement>;
  height: number;
  layout: ReturnType<typeof useAppWindowLayout>;
  variant?: 'landscape' | 'square';
  width: number;
}): Record<ChatTargetId, TargetRect> {
  const bottomTabs = bottomTabsPlacement(composerRect, height);
  const composerLeft = composerRect.left - composerRect.width / 2;
  const composerTop = composerInputTop(composerRect, true);
  const inputWidth = composerRect.width;
  const actionBarTop = composerTop + composerInputHeight - 44;
  const actionButtonTop = actionBarTop + 2;
  const actionButtonSize = 32;
  const quickPromptButtonLeft = composerLeft + 88;
  const quickPromptMenuTop = actionBarTop - 154;
  const sendWidth = 92;
  const sendHeight = 32;
  const bottomButtonHeight = 28;
  const bottomButtonTop = bottomTabs.top + 8;
  const recentButtonWidth = 160;
  const recentMenuTop = composerTop + composerInputHeight - 12 - 116;
  const windowLeft = Number(layout.windowStyle.left ?? 0);
  const windowTop = Number(layout.windowStyle.top ?? 0);
  const windowWidth = Number(layout.windowStyle.width ?? width);
  const windowHeight = Number(layout.windowStyle.height ?? height);
  const mainLeft = windowLeft + 72;
  const mainWidth = windowWidth - 72;

  return {
    // The plan's approve buttons live at the BOTTOM of the bottom-pinned
    // conversation, a fixed distance above the window bottom (the queued
    // message + composer clearance below them are fixed-height), so anchor the
    // target to windowBottom rather than a fraction of the content area.
    approvePlanPrimary: {
      height: 32,
      left: mainLeft + mainWidth * 0.145,
      top: windowTop + windowHeight - 329,
      width: 280,
    },
    quickPromptFirst: {
      height: 36,
      left: quickPromptButtonLeft + actionButtonSize / 2 - 128,
      top: quickPromptMenuTop + 38,
      width: 256,
    },
    quickPromptsButton: {
      height: actionButtonSize,
      left: quickPromptButtonLeft,
      top: actionButtonTop,
      width: actionButtonSize,
    },
    quickPromptSend: {
      height: sendHeight,
      left: composerLeft + inputWidth - sendWidth - 16,
      top: actionBarTop,
      width: sendWidth,
    },
    recentThreadRowFirst: {
      height: 34,
      left: bottomTabs.left,
      top: recentMenuTop - 22,
      width: bottomTabs.width,
    },
    recentThreads: {
      height: bottomButtonHeight,
      left: bottomTabs.left,
      top: bottomButtonTop,
      width: recentButtonWidth,
    },
    sendButton: {
      height: sendHeight,
      left: composerLeft + inputWidth - sendWidth - 16,
      top: actionBarTop,
      width: sendWidth,
    },
    // Same rect as sendButton — the queued follow-up clicks the same Send button.
    queueSendButton: {
      height: sendHeight,
      left: composerLeft + inputWidth - sendWidth - 16,
      top: actionBarTop,
      width: sendWidth,
    },
    threadsBreadcrumb: {
      height: 18,
      left: windowLeft + 118,
      top: windowTop + 14,
      width: 66,
    },
  };
}

function emptyThreadQuoteForFrame(
  frame: number,
  layout: ReturnType<typeof useAppWindowLayout>,
  variant?: 'landscape' | 'square',
) {
  const enter = ease(frame, 0, 12);
  if (frame >= 210) return null;

  const windowLeft = Number(layout.windowStyle.left ?? 0);
  const windowTop = Number(layout.windowStyle.top ?? 0);
  const windowWidth = Number(layout.windowStyle.width ?? 1440);
  const windowHeight = Number(layout.windowStyle.height ?? 900);
  const mainLeft = windowLeft + 72;
  const mainTop = windowTop + 42;
  const mainWidth = windowWidth - 72;
  const mainHeight = windowHeight - 42 - composerInputHeight - bottomTabsHeight - (variant === 'square' ? 34 : 28);

  return {
    style: {
      left: mainLeft,
      opacity: enter,
      top: mainTop + mainHeight * 0.48,
      transform: `translateY(${mix(8, 0, enter)}px)`,
      width: mainWidth,
    },
    text: '"Every creator gets paid. Every buyer gets a receipt."',
  };
}

function composerPlacement({
  height,
  layout,
  variant,
  width,
}: {
  height: number;
  layout: ReturnType<typeof useAppWindowLayout>;
  variant?: 'landscape' | 'square';
  width: number;
}) {
  const windowLeft = Number(layout.windowStyle.left ?? 0);
  const windowTop = Number(layout.windowStyle.top ?? 0);
  const windowWidth = Number(layout.windowStyle.width ?? width);
  const windowHeight = Number(layout.windowStyle.height ?? height);
  const mainLeft = windowLeft + 72;
  const mainWidth = windowWidth - 72;

  return {
    left: mainLeft + mainWidth / 2,
    top: windowTop + windowHeight - (variant === 'square' ? 20 : 18),
    width: Math.min(mainWidth * 0.8, 1060),
  };
}

// One continuous timeline: the cursor stays visible and parked between
// actions, and every instant surface swap (dashboard -> form -> board)
// lands right after its click at full cursor opacity.
function boardCursorForFrame(
  frame: number,
  windowBox: {height: number; left: number; top: number; width: number},
  width: number,
  height: number,
): CursorPath | null {
  return boardInteractions.path(boardCursorTargets(windowBox, width, height), frame, undefined, 'percent');
}

function windowBoxFromLayout(layout: ReturnType<typeof useAppWindowLayout>, width: number, height: number) {
  return {
    height: Number(layout.windowStyle.height ?? height),
    left: Number(layout.windowStyle.left ?? 0),
    top: Number(layout.windowStyle.top ?? 0),
    width: Number(layout.windowStyle.width ?? width),
  };
}

function boardCursorTargets(
  windowBox: {height: number; left: number; top: number; width: number},
  width: number,
  height: number,
): Record<BoardTargetId, TargetRect> {
  const {activeCard, inProgressDrop} = boardDragTargets(windowBox, {height, width});
  const chrome = boardChromeTargets(windowBox, {height, width});
  return {
    activeCard,
    inProgressDrop,
    activeDashboardTabPin: chrome.activeDashboardTabPin,
    createSaveButton: chrome.createSaveButton,
    createThreadButton: chrome.createThreadButton,
    dashboardArea: chrome.dashboardArea,
    kanbanViewButton: chrome.kanbanViewButton,
    linkActionButton: chrome.linkActionButton,
    linkThreadButton: chrome.linkThreadButton,
  };
}
