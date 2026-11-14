import type {ReactNode} from 'react';
import {MarkdownViewer} from './MarkdownViewer';
import {MessageBubble} from './MessageBubble';
import {PlanArtifactCard} from './PlanArtifactCard';
import {ThreadChatCanvas} from './ThreadChatCanvas';
import {ToolActivityBlock} from './ToolActivityBlock';
import type {PlanArtifactState, ToolActivityBlockState} from './threadTypes';

type ThreadConversationProps = {
  assistant: {
    artifact?: PlanArtifactState;
    markdown: string;
    toolActivity?: {
      rowOpacities?: number[];
      state: ToolActivityBlockState;
    };
  };
  children?: ReactNode;
  createdAt?: string;
  systemMessage: string;
  userMessage: ReactNode;
};

// Reusable thread conversation surface for app-like scenes. Film shots provide
// frame-derived text/cursor overlays; message rendering stays here.
export function ThreadConversation({assistant, children, createdAt, systemMessage, userMessage}: ThreadConversationProps) {
  return (
    <ThreadChatCanvas>
      <MessageBubble sender="system">{systemMessage}</MessageBubble>
      <MessageBubble sender="user" createdAt={createdAt} isTail>{userMessage}</MessageBubble>
      <MessageBubble sender="assistant" createdAt={createdAt}>
        {assistant.toolActivity ? <ToolActivityBlock rowOpacities={assistant.toolActivity.rowOpacities} state={assistant.toolActivity.state} /> : null}
        <MarkdownViewer content={assistant.markdown} />
        {assistant.artifact ? <PlanArtifactCard artifact={assistant.artifact} /> : null}
      </MessageBubble>
      {children}
    </ThreadChatCanvas>
  );
}
