import type {CSSProperties, ReactNode} from 'react';
import {ApprovalBlock} from './ApprovalBlock';
import {MarkdownViewer} from './MarkdownViewer';
import {MarkdownBlock} from './MarkdownBlock';
import {MessageBubble} from './MessageBubble';
import {PromptBlock} from './PromptBlock';
import {ThinkingBlock} from './ThinkingBlock';
import {ThreadChatCanvas} from './ThreadChatCanvas';
import {ToolActivityBlock} from './ToolActivityBlock';
import type {ApprovalBlockState, MarkdownBlockState, PromptBlockState, ThinkingBlockState, ToolActivityBlockState} from './threadTypes';
import {makeStyles} from '../primitives/makeStyles';
import './ThreadConversation.module.css';

const styles = makeStyles('ThreadConversation');

type ThreadConversationProps = {
  align?: 'top' | 'bottom';
  assistant: {
    approval?: ApprovalBlockState;
    markdown: string;
    markdownBlock?: MarkdownBlockState;
    markdownStyle?: CSSProperties;
    promptBlock?: PromptBlockState;
    thinking?: ThinkingBlockState;
    thinkingStyle?: CSSProperties;
    toolActivity?: {
      rowOpacities?: number[];
      state: ToolActivityBlockState;
    };
  };
  additionalAssistantMessages?: AssistantConversationMessage[];
  children?: ReactNode;
  createdAt?: number | string;
  messageStyles?: {
    assistant?: CSSProperties;
    system?: CSSProperties;
    user?: CSSProperties;
  };
  queuedMessage?: ReactNode;
  queuedMessageStyle?: CSSProperties;
  systemMessage?: ReactNode;
  topInset?: number;
  userMessage: ReactNode;
};

type AssistantConversationMessage = ThreadConversationProps['assistant'] & {
  autoHide?: boolean;
  style?: CSSProperties;
};

// Reusable thread conversation surface for app-like scenes. Film shots provide
// frame-derived text/cursor overlays; message rendering stays here.
export function ThreadConversation({align, additionalAssistantMessages, assistant, children, createdAt, messageStyles, queuedMessage, queuedMessageStyle, systemMessage, topInset = 0, userMessage}: ThreadConversationProps) {
  return (
    <ThreadChatCanvas align={align}>
      {topInset > 0 ? <div style={{height: topInset}} /> : null}
      {systemMessage ? <div style={messageStyles?.system}><MessageBubble sender="system">{systemMessage}</MessageBubble></div> : null}
      <div style={messageStyles?.user}><MessageBubble sender="user" createdAt={createdAt} isTail>{userMessage}</MessageBubble></div>
      <AssistantMessage createdAt={createdAt} message={assistant} style={messageStyles?.assistant} />
      {additionalAssistantMessages?.map((message, index) => (
        <AssistantMessage createdAt={createdAt} key={index} message={message} style={message.style} />
      ))}
      {/* A queued follow-up message always renders last, at the bottom of the conversation. */}
      {queuedMessage ? <div style={queuedMessageStyle}><MessageBubble sender="user" status="queued">{queuedMessage}</MessageBubble></div> : null}
      {children}
    </ThreadChatCanvas>
  );
}

function AssistantMessage({createdAt, message, style}: {createdAt?: number | string; message: AssistantConversationMessage; style?: CSSProperties}) {
  const hasAssistantContent = Boolean(message.toolActivity || message.markdown.trim() || message.markdownBlock || message.promptBlock || message.approval || message.thinking);
  const hasInteractionBlocks = Boolean(message.markdownBlock || message.promptBlock || message.approval);
  if (!hasAssistantContent) return null;
  if (message.autoHide) {
    return (
      <div style={style}>
        <MessageBubble asUser autoHide sender="assistant" createdAt={createdAt}>
          {message.markdown}
        </MessageBubble>
      </div>
    );
  }
  return (
    <div style={style}>
      <MessageBubble autoHide={message.autoHide} sender="assistant" createdAt={createdAt}>
        {message.toolActivity ? (
          <div className={styles.toolBlocks}>
            <ToolActivityBlock rowOpacities={message.toolActivity.rowOpacities} state={message.toolActivity.state} />
          </div>
        ) : null}
        {message.thinking ? (
          <div className={styles.interactionBlocks} style={message.thinkingStyle}>
            <ThinkingBlock state={message.thinking} />
          </div>
        ) : null}
        {message.markdown.trim() ? (
          <div style={message.markdownStyle}>
            <MarkdownViewer content={message.markdown} />
          </div>
        ) : null}
        {hasInteractionBlocks ? (
          <div className={styles.interactionBlocks}>
            {message.markdownBlock ? <MarkdownBlock state={message.markdownBlock} /> : null}
            {message.promptBlock ? <PromptBlock state={message.promptBlock} /> : null}
            {message.approval ? <ApprovalBlock state={message.approval} /> : null}
          </div>
        ) : null}
      </MessageBubble>
    </div>
  );
}
