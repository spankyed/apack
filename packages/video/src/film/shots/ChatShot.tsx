import type {ReactNode} from 'react';
import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {ChatComposer} from '../../agentbuddy-ui/chat/ChatComposer';
import type {ChatComposerInlineNode} from '../../agentbuddy-ui/chat/chatTypes';
import {EmptyThreadQuote} from '../../agentbuddy-ui/threads/EmptyThreadQuote';
import {ReferencePill} from '../../agentbuddy-ui/chat/ReferencePill';
import {ThreadConversation} from '../../agentbuddy-ui/threads/ThreadConversation';
import {TextCaret} from '../../agentbuddy-ui/primitives/TextCaret';
import {Cursor} from '../overlays/Cursor';
import {chatInteractions, chatShotViewForFrame, type ChatTargetId} from '../state/chat';
import {useAppWindowLayout} from '../appWindowLayout';
import {ease, mix} from '../state/timeline';
import {targetDebugOverlay} from '../interaction/cursorTargets';
import type {CursorPath, TargetRect} from '../interaction/cursorTargets';
import {useVideoConfig} from 'remotion';
import './ChatShot.module.css';
import {makeStyles} from '../../agentbuddy-ui/primitives/makeStyles';

const styles = makeStyles('ChatShot');
const bottomTabsHeight = 38;
const composerInputHeight = 112;
const composerEditorInsetLeft = 16;
const composerEditorInsetTop = 12;
const referencePopupAboveCursorOffset = 4;
const showTargetDebug = false;


export function ChatShot({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const layout = useAppWindowLayout({variant});
  const {height, width} = useVideoConfig();
  const appReveal = ease(frame, 126, 178);
  const composerDock = ease(frame, 118, 178);
  const composerRect = composerPlacement({dock: composerDock, height, layout, variant, width});
  const targets = chatTargetsForFrame({composerRect, dock: composerDock, height, layout, variant, width});
  const geo = {frame, space: 'px' as const, targets, viewport: {height, width}};
  const view = chatShotViewForFrame(frame, {
    over: (target: ChatTargetId) => chatInteractions.over(target, geo),
    pressing: (target: ChatTargetId) => chatInteractions.pressing(target, frame),
  });
  const composer = withPopupPositions(view.composer, composerRect, composerDock, height);
  const cursorPath = chatCursorForFrame(frame, targets, width, height);
  const quote = emptyThreadQuoteForFrame(frame, layout, variant);

  return (
    <div className={styles.root}>
      <div
        className={styles.appReveal}
        style={{
          opacity: appReveal,
          transform: `translateY(${mix(22, 0, appReveal)}px) scale(${mix(0.99, 1, appReveal)})`,
        }}
      >
        <AppWindow activePlugin="threads" breadcrumbs={view.breadcrumbs} composer={false} layout={layout}>
          <div style={{height: '100%', ...view.conversationStyle}}>
            <ThreadConversation
              align="bottom"
              additionalAssistantMessages={view.conversation.additionalAssistantMessages}
              assistant={view.conversation.assistant}
              createdAt={view.conversation.createdAt}
              messageStyles={view.messageStyles}
              queuedMessage={view.conversation.queuedMessage ? (
                <div className={`${styles.viewerWrapper} tiptap-wrapper tiptap-viewer tiptap-viewer-chat`}>
                  <div className={`${styles.viewerProse} ProseMirror`} contentEditable={false}>
                    <p>{view.conversation.queuedMessage.text}</p>
                  </div>
                </div>
              ) : undefined}
              systemMessage={view.conversation.systemMessage}
              userMessage={
                <div className={`${styles.viewerWrapper} tiptap-wrapper tiptap-viewer tiptap-viewer-chat`}>
                  <div className={`${styles.viewerProse} ProseMirror`} contentEditable={false}>
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
        className={styles.composerMotion}
        style={{
          left: composerRect.left,
          top: composerRect.top,
          width: composerRect.width,
          transform: `translate(-50%, ${mix(-50, -100, composerDock)}%) scale(${mix(1.04, 1, composerDock)})`,
        }}
      >
        <ChatComposer formStyle={{width: '100%'}} state={composer} />
      </div>
      {quote ? <EmptyThreadQuote style={quote.style} text={quote.text} /> : null}
      {showTargetDebug ? <TargetDebugOverlay targets={targets} /> : null}
      {cursorPath ? <Cursor frame={frame} {...cursorPath} /> : null}
    </div>
  );
}

function withPopupPositions(
  composer: ReturnType<typeof chatShotViewForFrame>['composer'],
  rect: ReturnType<typeof composerPlacement>,
  dock: number,
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
          dock,
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
          dock,
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
          dock,
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
                  bottom: viewportHeight - (composerInputTop(rect, dock, Boolean(composer.bottomTabs)) + composerInputHeight - 12),
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
  dock: number,
  hasBottomTabs: boolean,
  rect: ReturnType<typeof composerPlacement>,
  viewportHeight: number,
) {
  const composerLeft = rect.left - rect.width / 2;
  const composerTop = composerInputTop(rect, dock, hasBottomTabs);
  const clampedAnchor = Math.min(Math.max(anchorCharacterIndex, 0), 36);
  return {
    bottom: viewportHeight - (composerTop + composerEditorInsetTop) + 4,
    left: composerLeft + composerEditorInsetLeft + estimatedInlineTextWidth(anchorText, clampedAnchor),
  };
}

function revertHistoryPopupPlacement(
  rect: ReturnType<typeof composerPlacement>,
  dock: number,
  hasBottomTabs: boolean,
  viewportHeight: number,
) {
  const composerLeft = rect.left - rect.width / 2;
  const composerTop = composerInputTop(rect, dock, hasBottomTabs);
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
  dock: number,
  hasBottomTabs: boolean,
  rect: ReturnType<typeof composerPlacement>,
  viewportHeight: number,
) {
  const composerLeft = rect.left - rect.width / 2;
  const composerTop = composerInputTop(rect, dock, hasBottomTabs);
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
  dock: number,
  hasBottomTabs: boolean,
) {
  const composerHeight = composerInputHeight + (hasBottomTabs ? bottomTabsHeight : 0);
  const translateYRatio = mix(0.5, 1, dock);
  return rect.top - composerHeight * translateYRatio;
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
  return chatInteractions.path(targets, frame, {height, width});
}

function chatTargetsForFrame({
  composerRect,
  dock,
  height,
  layout,
  variant,
  width,
}: {
  composerRect: ReturnType<typeof composerPlacement>;
  dock: number;
  height: number;
  layout: ReturnType<typeof useAppWindowLayout>;
  variant?: 'landscape' | 'square';
  width: number;
}): Record<ChatTargetId, TargetRect> {
  const bottomTabs = bottomTabsPlacement(composerRect, height);
  const composerLeft = composerRect.left - composerRect.width / 2;
  const composerTop = composerInputTop(composerRect, dock, true);
  const inputWidth = composerRect.width;
  const actionBarTop = composerTop + composerInputHeight - 44;
  const actionButtonTop = actionBarTop + 2;
  const actionButtonSize = 32;
  const quickPromptButtonLeft = composerLeft + 88;
  const quickPromptMenuTop = actionBarTop - 154;
  const sendWidth = 92;
  const sendHeight = 32;
  const bottomButtonHeight = 28;
  const bottomButtonTop = bottomTabs.top + bottomTabsHeight * (1 - dock) + 8;
  const recentButtonWidth = 160;
  const newThreadButtonWidth = 150;
  const activeThreadWidth = Math.min(320, bottomTabs.width * 0.34);
  const recentMenuTop = composerTop + composerInputHeight - 12 - 116;
  const windowLeft = Number(layout.windowStyle.left ?? 0);
  const windowTop = Number(layout.windowStyle.top ?? 0);
  const windowWidth = Number(layout.windowStyle.width ?? width);
  const windowHeight = Number(layout.windowStyle.height ?? height);
  const mainLeft = windowLeft + 72;
  const mainWidth = windowWidth - 72;

  return {
    // Anchored to the window bottom: the approve buttons sit a fixed distance
    // above it in the bottom-pinned conversation (queued message + composer
    // clearance below are fixed-height), unlike the old content-fraction value.
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
    // Unused by the old film's cursor (no breadcrumb nav); present only to
    // satisfy the shared ChatTargetId map.
    threadsBreadcrumb: {height: 18, left: windowLeft + 118, top: windowTop + 14, width: 66},
  };
}

function TargetDebugOverlay({targets}: {targets: Record<ChatTargetId, TargetRect>}) {
  return (
    <>
      {targetDebugOverlay(targets).map(({id, rect}) => (
        <div
          key={id}
          style={{
            position: 'absolute',
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            zIndex: 60,
            border: '1px solid rgb(34 211 238 / 0.75)',
            background: 'rgb(34 211 238 / 0.08)',
            color: 'rgb(165 243 252)',
            fontSize: 10,
            pointerEvents: 'none',
          }}
        >
          {id}
        </div>
      ))}
    </>
  );
}

function emptyThreadQuoteForFrame(
  frame: number,
  layout: ReturnType<typeof useAppWindowLayout>,
  variant?: 'landscape' | 'square',
) {
  const enter = ease(frame, 132, 150);
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
  dock,
  height,
  layout,
  variant,
  width,
}: {
  dock: number;
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
  const finalWidth = Math.min(mainWidth * 0.8, 1060);
  const startWidth = variant === 'square' ? Math.min(720, width - 96) : Math.min(960, width - 160);
  const finalCenterX = mainLeft + mainWidth / 2;
  const finalBottomY = windowTop + windowHeight - (variant === 'square' ? 20 : 18);

  return {
    left: mix(width / 2, finalCenterX, dock),
    top: mix(height / 2, finalBottomY, dock),
    width: mix(startWidth, finalWidth, dock),
  };
}
