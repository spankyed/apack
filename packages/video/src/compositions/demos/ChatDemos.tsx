import {useCurrentFrame} from 'remotion';
import {ChatComposer} from '../../agentbuddy-ui/chat/ChatComposer';
import type {ChatComposerState} from '../../agentbuddy-ui/chat/chatTypes';
import {ActionButtonsBlock} from '../../agentbuddy-ui/threads/ActionButtonsBlock';
import {ApprovalBlock} from '../../agentbuddy-ui/threads/ApprovalBlock';
import {ButtonGroupBlock} from '../../agentbuddy-ui/threads/ButtonGroupBlock';
import {ChoiceBlock} from '../../agentbuddy-ui/threads/ChoiceBlock';
import {ContextUsageBlock} from '../../agentbuddy-ui/threads/ContextUsageBlock';
import {FilePickerBlock} from '../../agentbuddy-ui/threads/FilePickerBlock';
import {LinkBlock} from '../../agentbuddy-ui/threads/LinkBlock';
import {MarkdownBlock} from '../../agentbuddy-ui/threads/MarkdownBlock';
import {MarkdownViewer} from '../../agentbuddy-ui/threads/MarkdownViewer';
import {MessageBubble} from '../../agentbuddy-ui/threads/MessageBubble';
import {NoteBlock} from '../../agentbuddy-ui/threads/NoteBlock';
import {PlanArtifactCard} from '../../agentbuddy-ui/threads/PlanArtifactCard';
import {PromptBlock} from '../../agentbuddy-ui/threads/PromptBlock';
import {ProjectSelectBlock} from '../../agentbuddy-ui/threads/ProjectSelectBlock';
import {QuestionBlock} from '../../agentbuddy-ui/threads/QuestionBlock';
import {SessionListBlock} from '../../agentbuddy-ui/threads/SessionListBlock';
import {TextInputBlock} from '../../agentbuddy-ui/threads/TextInputBlock';
import {ThinkingBlock} from '../../agentbuddy-ui/threads/ThinkingBlock';
import {TogglesBlock} from '../../agentbuddy-ui/threads/TogglesBlock';
import {ToolActivityBlock} from '../../agentbuddy-ui/threads/ToolActivityBlock';
import {ToolInputBlock} from '../../agentbuddy-ui/threads/ToolInputBlock';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {ChatShot} from '../../film/shots/ChatShot';
import {
  actionButtonsBlockDemoState,
  actionButtonsDisabledDemoState,
  launchComposerState,
  launchComposerWithAttachmentState,
  launchComposerModeMenuState,
  launchComposerPhaseMenuState,
  launchPlanArtifact,
  approvalBlockDemoState,
  approvalBlockRespondedState,
  buttonGroupBlockDemoState,
  buttonGroupRespondedState,
  chatComposerActiveThreadRenameDemoState,
  chatComposerBusyRecordingDemoState,
  chatComposerCommandActiveDemoState,
  chatComposerCommandSuggestionDemoState,
  chatComposerCommandSuggestionEmptyDemoState,
  chatComposerDocumentReferenceItemsDemoState,
  chatComposerDropActiveDemoState,
  chatComposerMixedAttachmentsDemoState,
  chatComposerNewThreadChildMenuDemoBaseState,
  chatComposerNewThreadProjectMenuDemoBaseState,
  chatComposerQuickPromptsEditingDemoState,
  chatComposerRecentThreadsDemoBaseState,
  chatComposerRecentThreadsEmptyDemoBaseState,
  chatComposerRecentThreadsRenameDemoBaseState,
  chatComposerReferenceCategoriesDemoState,
  chatComposerReferenceEmptyCategoryDemoState,
  chatComposerReferenceEmptyItemsDemoState,
  chatComposerReferenceFilteredCategoriesDemoState,
  chatComposerReferencePillsDemoState,
  chatComposerReferencesDemoState,
  chatComposerRevertActionsDemoState,
  chatComposerRevertHistoryDemoState,
  chatComposerStatusLineDemoState,
  chatComposerThreadReferenceItemsDemoState,
  choiceBlockDemoState,
  choiceBlockRespondedState,
  contextUsageBlockDemoState,
  filePickerBlockDemoState,
  fullMarkdownViewerDemoContent,
  linkBlockDemoState,
  markdownBlockDemoState,
  messageBubbleDemoState,
  noteBlockDemoState,
  promptBlockDemoState,
  projectSelectBlockDemoState,
  projectSelectRespondedState,
  questionBlockDemoState,
  questionBlockRespondedState,
  sessionListBlockDemoState,
  textInputBlockDemoState,
  toolInputBashDemoState,
  thinkingBlockDemoState,
  togglesBlockDemoState,
  toolInputJsonDemoState,
  toolInputBlockDemoState,
  toolInputWriteDemoState,
  toolActivityViewForFrame,
} from '../../film/state/chat';
import {DemoBottomSlot, DemoSlot, DemoStack} from '../DemoLayout';

const launchPreviewUrl = new URL('../../../../../resources/draft-final.png', import.meta.url).toString();
const referenceDemoPopupPosition = {
  bottom: 220,
  left: 200,
};
const referenceDemoUpperPopupPosition = {
  bottom: 432,
  left: 200,
};
const commandDemoPopupPosition = {
  bottom: 214,
  left: 160,
};
const recentThreadsDemoPopupPosition = {
  bottom: 214,
  left: 144,
  width: 1152,
};
const newThreadDemoPopupPosition = {
  bottom: 214,
  left: 1112,
  top: 604,
};
type ReferenceAutocompleteDemoState = NonNullable<ChatComposerState['referenceAutocomplete']>;

function referenceAutocompleteDemoState<T extends ReferenceAutocompleteDemoState>(
  state: T,
  slot: 'lower' | 'upper' = 'lower',
): T {
  return {
    ...state,
    popupPosition: slot === 'upper' ? referenceDemoUpperPopupPosition : referenceDemoPopupPosition,
  };
}

function commandPopupState(state: ChatComposerState): ChatComposerState {
  return {
    ...state,
    commandSuggestion: state.commandSuggestion
      ? {...state.commandSuggestion, popupPosition: commandDemoPopupPosition}
      : undefined,
  };
}

function recentThreadsPopupState(state: ChatComposerState): ChatComposerState {
  return {
    ...state,
    bottomTabs: state.bottomTabs
      ? {
          ...state.bottomTabs,
          recentThreadsMenu: state.bottomTabs.recentThreadsMenu
            ? {...state.bottomTabs.recentThreadsMenu, popupPosition: recentThreadsDemoPopupPosition}
            : undefined,
        }
      : undefined,
  };
}

function newThreadPopupState(state: ChatComposerState): ChatComposerState {
  return {
    ...state,
    bottomTabs: state.bottomTabs
      ? {
          ...state.bottomTabs,
          newThreadMenu: state.bottomTabs.newThreadMenu
            ? {...state.bottomTabs.newThreadMenu, popupPosition: newThreadDemoPopupPosition}
            : undefined,
        }
      : undefined,
  };
}

function composerReferencePopupState(
  state: ChatComposerState,
  slot: 'lower' | 'upper' = 'lower',
): ChatComposerState {
  return {
    ...state,
    referenceAutocomplete: state.referenceAutocomplete
      ? referenceAutocompleteDemoState(state.referenceAutocomplete, slot)
      : undefined,
  };
}

export const ChatComposerDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer state={launchComposerState} />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerWithAttachmentDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer state={launchComposerWithAttachmentState} />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerMixedAttachmentsDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={chatComposerMixedAttachmentsDemoState(launchPreviewUrl)}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerStatusLineDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer state={chatComposerStatusLineDemoState} />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerQuickPromptsEditingDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={chatComposerQuickPromptsEditingDemoState}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerRevertHistoryDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={chatComposerRevertHistoryDemoState}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerRevertActionsDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={chatComposerRevertActionsDemoState}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerModeMenuDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer state={launchComposerModeMenuState} />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerPhaseMenuDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer state={launchComposerPhaseMenuState} />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerInputStatesDemo = () => (
  <SurfaceFrame>
    <DemoSlot style={{left: 0, right: 0, bottom: 580}}>
      <ChatComposer state={chatComposerCommandActiveDemoState} />
    </DemoSlot>
    <DemoSlot style={{left: 0, right: 0, bottom: 330}}>
      <ChatComposer state={chatComposerDropActiveDemoState} />
    </DemoSlot>
    <DemoSlot style={{left: 0, right: 0, bottom: 80}}>
      <ChatComposer state={chatComposerBusyRecordingDemoState} />
    </DemoSlot>
  </SurfaceFrame>
);

export const ChatComposerCommandSuggestionDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={commandPopupState(chatComposerCommandSuggestionDemoState)}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerCommandSuggestionEmptyDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={commandPopupState(chatComposerCommandSuggestionEmptyDemoState)}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerReferenceCategoriesDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={composerReferencePopupState(chatComposerReferenceCategoriesDemoState)}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerReferenceFilteredCategoriesDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={composerReferencePopupState(chatComposerReferenceFilteredCategoriesDemoState)}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerReferencesDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={composerReferencePopupState(chatComposerReferencesDemoState)}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerReferenceItemTypesDemo = () => (
  <SurfaceFrame>
    <DemoSlot style={{left: 0, right: 0, bottom: 292}}>
      <ChatComposer
        state={composerReferencePopupState(chatComposerThreadReferenceItemsDemoState, 'upper')}
      />
    </DemoSlot>
    <DemoSlot style={{left: 0, right: 0, bottom: 80}}>
      <ChatComposer
        state={composerReferencePopupState(chatComposerDocumentReferenceItemsDemoState)}
      />
    </DemoSlot>
  </SurfaceFrame>
);

export const ChatComposerReferencePillsDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={chatComposerReferencePillsDemoState}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerReferenceEmptyStatesDemo = () => (
  <SurfaceFrame>
    <DemoSlot style={{left: 0, right: 0, bottom: 292}}>
      <ChatComposer
        state={composerReferencePopupState(chatComposerReferenceEmptyCategoryDemoState, 'upper')}
      />
    </DemoSlot>
    <DemoSlot style={{left: 0, right: 0, bottom: 80}}>
      <ChatComposer
        state={composerReferencePopupState(chatComposerReferenceEmptyItemsDemoState)}
      />
    </DemoSlot>
  </SurfaceFrame>
);

export const ChatComposerRecentThreadsDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={recentThreadsPopupState(chatComposerRecentThreadsDemoBaseState)}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerRecentThreadsEmptyDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={recentThreadsPopupState(chatComposerRecentThreadsEmptyDemoBaseState)}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerRecentThreadsRenameDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={recentThreadsPopupState(chatComposerRecentThreadsRenameDemoBaseState)}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerActiveThreadRenameDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={chatComposerActiveThreadRenameDemoState}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerNewThreadProjectMenuDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={newThreadPopupState(chatComposerNewThreadProjectMenuDemoBaseState)}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ChatComposerNewThreadChildMenuDemo = () => (
  <SurfaceFrame>
    <DemoBottomSlot>
      <ChatComposer
        state={newThreadPopupState(chatComposerNewThreadChildMenuDemoBaseState)}
      />
    </DemoBottomSlot>
  </SurfaceFrame>
);

export const ToolActivityDemo = () => {
  const frame = useCurrentFrame();
  const view = toolActivityViewForFrame(frame);
  return (
    <SurfaceFrame>
      <DemoSlot style={{left: 240, top: 112, width: 620}}>
        <ToolActivityBlock rowOpacities={view.rowOpacities} state={view.state} />
      </DemoSlot>
      <DemoSlot style={{right: 240, bottom: 120, width: 520}}>
        <PlanArtifactCard artifact={launchPlanArtifact} />
      </DemoSlot>
    </SurfaceFrame>
  );
};

export const InteractionBlocksDemo = () => (
  <SurfaceFrame>
    <DemoSlot style={{left: 160, top: 54, width: 600}}>
      <DemoStack gap={12}>
        <ThinkingBlock state={thinkingBlockDemoState} />
        <ToolInputBlock state={toolInputBlockDemoState} />
        <ToolInputBlock state={toolInputWriteDemoState} />
        <ToolInputBlock state={toolInputBashDemoState} />
        <ToolInputBlock state={toolInputJsonDemoState} />
        <ApprovalBlock state={approvalBlockDemoState} />
        <ActionButtonsBlock state={actionButtonsBlockDemoState} />
        <ActionButtonsBlock state={actionButtonsDisabledDemoState} />
        <TogglesBlock state={togglesBlockDemoState} />
        <TextInputBlock state={textInputBlockDemoState} />
        <FilePickerBlock state={filePickerBlockDemoState} />
        <ContextUsageBlock state={contextUsageBlockDemoState} />
      </DemoStack>
    </DemoSlot>
    <DemoSlot style={{right: 160, top: 54, width: 460}}>
      <DemoStack gap={12}>
        <PromptBlock state={promptBlockDemoState} />
        <NoteBlock state={noteBlockDemoState} />
        <MarkdownBlock state={markdownBlockDemoState} />
        <LinkBlock state={linkBlockDemoState} />
        <ChoiceBlock state={choiceBlockDemoState} />
        <QuestionBlock state={questionBlockDemoState} />
        <ButtonGroupBlock state={buttonGroupBlockDemoState} />
        <ProjectSelectBlock state={projectSelectBlockDemoState} />
        <ApprovalBlock state={approvalBlockRespondedState} />
        <ChoiceBlock state={choiceBlockRespondedState} />
        <QuestionBlock state={questionBlockRespondedState} />
        <ButtonGroupBlock state={buttonGroupRespondedState} />
        <ProjectSelectBlock state={projectSelectRespondedState} />
        <SessionListBlock state={sessionListBlockDemoState} />
      </DemoStack>
    </DemoSlot>
  </SurfaceFrame>
);

export const ToolInputBlocksDemo = () => (
  <SurfaceFrame>
    <DemoSlot style={{left: 220, top: 72, width: 700}}>
      <DemoStack>
        <ThinkingBlock state={thinkingBlockDemoState} />
        <ToolInputBlock state={toolInputBlockDemoState} />
        <ToolInputBlock state={toolInputWriteDemoState} />
        <ToolInputBlock state={toolInputBashDemoState} />
        <ToolInputBlock state={toolInputJsonDemoState} />
      </DemoStack>
    </DemoSlot>
  </SurfaceFrame>
);

export const InteractionControlsDemo = () => (
  <SurfaceFrame>
    <DemoSlot style={{left: 220, top: 72, width: 560}}>
      <DemoStack>
        <ApprovalBlock state={approvalBlockDemoState} />
        <ApprovalBlock state={approvalBlockRespondedState} />
        <ActionButtonsBlock state={actionButtonsBlockDemoState} />
        <ActionButtonsBlock state={actionButtonsDisabledDemoState} />
        <ChoiceBlock state={choiceBlockDemoState} />
        <ChoiceBlock state={choiceBlockRespondedState} />
      </DemoStack>
    </DemoSlot>
    <DemoSlot style={{right: 220, top: 72, width: 520}}>
      <DemoStack>
        <QuestionBlock state={questionBlockDemoState} />
        <QuestionBlock state={questionBlockRespondedState} />
        <ButtonGroupBlock state={buttonGroupBlockDemoState} />
        <ButtonGroupBlock state={buttonGroupRespondedState} />
        <TextInputBlock state={textInputBlockDemoState} />
        <FilePickerBlock state={filePickerBlockDemoState} />
        <ProjectSelectBlock state={projectSelectBlockDemoState} />
        <ProjectSelectBlock state={projectSelectRespondedState} />
      </DemoStack>
    </DemoSlot>
  </SurfaceFrame>
);

export const ContentBlocksDemo = () => (
  <SurfaceFrame>
    <DemoSlot style={{left: 220, top: 72, width: 580}}>
      <DemoStack>
        <PromptBlock state={promptBlockDemoState} />
        <NoteBlock state={noteBlockDemoState} />
        <MarkdownBlock state={markdownBlockDemoState} />
        <LinkBlock state={linkBlockDemoState} />
      </DemoStack>
    </DemoSlot>
    <DemoSlot style={{right: 220, top: 72, width: 520}}>
      <DemoStack>
        <TogglesBlock state={togglesBlockDemoState} />
        <SessionListBlock state={sessionListBlockDemoState} />
        <ContextUsageBlock state={contextUsageBlockDemoState} />
      </DemoStack>
    </DemoSlot>
  </SurfaceFrame>
);

export const FullMarkdownViewerDemo = () => (
  <SurfaceFrame>
    <DemoSlot style={{left: 320, top: 120, width: 640}}>
      <MarkdownViewer
        content={fullMarkdownViewerDemoContent}
        variant="full"
      />
    </DemoSlot>
  </SurfaceFrame>
);

export const PlanArtifactDemo = () => (
  <SurfaceFrame>
    <DemoSlot style={{left: 320, right: 320, top: 128, bottom: 128}}>
      <PlanArtifactCard artifact={launchPlanArtifact} />
    </DemoSlot>
  </SurfaceFrame>
);

export const MessageBubbleDemo = () => (
  <SurfaceFrame>
    <DemoSlot style={{left: 220, right: 220, top: 104}}>
      <MessageBubble sender="system">{messageBubbleDemoState.system}</MessageBubble>
      <MessageBubble sender="marker">{messageBubbleDemoState.marker}</MessageBubble>
      <MessageBubble sender="user" createdAt={messageBubbleDemoState.createdAt}>{messageBubbleDemoState.user}</MessageBubble>
      <MessageBubble sender="user" createdAt={messageBubbleDemoState.createdAt} isCommand>{messageBubbleDemoState.commandUser}</MessageBubble>
      <MessageBubble sender="user" createdAt={messageBubbleDemoState.createdAt} references={messageBubbleDemoState.references} truncated>{messageBubbleDemoState.longUser}</MessageBubble>
      <MessageBubble sender="user" createdAt={messageBubbleDemoState.createdAt} references={messageBubbleDemoState.references} expanded truncated>{messageBubbleDemoState.longUser}</MessageBubble>
      <MessageBubble sender="user" createdAt={messageBubbleDemoState.createdAt} isTail status="queued">{messageBubbleDemoState.queuedUser}</MessageBubble>
      <MessageBubble sender="user" createdAt={messageBubbleDemoState.createdAt} isTail status="cancelled">{messageBubbleDemoState.cancelledUser}</MessageBubble>
      <MessageBubble sender="assistant" autoHide>{messageBubbleDemoState.aside}</MessageBubble>
      <MessageBubble sender="assistant" autoHide expanded>{messageBubbleDemoState.aside}</MessageBubble>
      <MessageBubble sender="assistant" createdAt={messageBubbleDemoState.createdAt}>{messageBubbleDemoState.assistant}</MessageBubble>
      <MessageBubble sender="assistant" createdAt={messageBubbleDemoState.createdAt} forkable={false}>{messageBubbleDemoState.assistant}</MessageBubble>
    </DemoSlot>
  </SurfaceFrame>
);

export const ChatSurfaceDemo = () => {
  const frame = useCurrentFrame();
  return (
    <SurfaceFrame>
      <ChatShot frame={frame} />
    </SurfaceFrame>
  );
};
