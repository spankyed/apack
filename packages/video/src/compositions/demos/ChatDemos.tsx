import {useCurrentFrame} from 'remotion';
import {ChatComposer} from '../../agentbuddy-ui/chat/ChatComposer';
import {ActionButtonsBlock} from '../../agentbuddy-ui/threads/ActionButtonsBlock';
import {ApprovalBlock} from '../../agentbuddy-ui/threads/ApprovalBlock';
import {ButtonGroupBlock} from '../../agentbuddy-ui/threads/ButtonGroupBlock';
import {ChoiceBlock} from '../../agentbuddy-ui/threads/ChoiceBlock';
import {ContextUsageBlock} from '../../agentbuddy-ui/threads/ContextUsageBlock';
import {FilePickerBlock} from '../../agentbuddy-ui/threads/FilePickerBlock';
import {LinkBlock} from '../../agentbuddy-ui/threads/LinkBlock';
import {MarkdownBlock} from '../../agentbuddy-ui/threads/MarkdownBlock';
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
  choiceBlockDemoState,
  choiceBlockRespondedState,
  contextUsageBlockDemoState,
  filePickerBlockDemoState,
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
      <MessageBubble sender="user" createdAt={messageBubbleDemoState.createdAt} references={messageBubbleDemoState.references} truncated>{messageBubbleDemoState.longUser}</MessageBubble>
      <MessageBubble sender="user" createdAt={messageBubbleDemoState.createdAt} references={messageBubbleDemoState.references} expanded truncated>{messageBubbleDemoState.longUser}</MessageBubble>
      <MessageBubble sender="user" createdAt={messageBubbleDemoState.createdAt} isTail status="queued">{messageBubbleDemoState.queuedUser}</MessageBubble>
      <MessageBubble sender="user" createdAt={messageBubbleDemoState.createdAt} isTail status="cancelled">{messageBubbleDemoState.cancelledUser}</MessageBubble>
      <MessageBubble sender="assistant" autoHide>{messageBubbleDemoState.aside}</MessageBubble>
      <MessageBubble sender="assistant" autoHide expanded>{messageBubbleDemoState.aside}</MessageBubble>
      <MessageBubble sender="assistant" createdAt={messageBubbleDemoState.createdAt}>{messageBubbleDemoState.assistant}</MessageBubble>
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
