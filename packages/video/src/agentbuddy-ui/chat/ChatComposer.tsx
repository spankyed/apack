import type {CSSProperties, ReactNode} from 'react';
import {AttachmentStrip} from './AttachmentStrip';
import {BottomThreadTabs} from './BottomThreadTabs';
import {CommandSuggestionPopup} from './CommandSuggestionPopup';
import {ComposerActionBar} from './ComposerActionBar';
import {ReferenceAutocomplete} from './ReferenceAutocomplete';
import {ReferencePill} from './ReferencePill';
import {RevertHistoryPopup} from './RevertHistoryPopup';
import type {ChatComposerState} from './chatTypes';
import './ChatComposer.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('ChatComposer');

// Mirrors packages/renderer/src/plugins/threads/chat/input.vue.
export function ChatComposer({formStyle, outerStyle, state}: {formStyle?: CSSProperties; outerStyle?: CSSProperties; state: ChatComposerState}) {
  const hasTextContent = Boolean(state.text?.trim());
  const hasAttachments = Boolean(state.attachments?.length);
  const sendDisabled = state.disabled || (!hasTextContent && !hasAttachments);
  return (
    <footer className={styles.outer} style={outerStyle}>
      <form className={styles.form} style={formStyle}>
        <div
          className={styles.inputCard}
          data-command-active={state.commandActive || undefined}
          data-disabled={state.disabled || undefined}
          data-drop-active={state.dropActive || undefined}
          data-onboarding-id="agent-chat-input"
          data-recording={state.recording || undefined}
        >
          <AttachmentStrip attachments={state.attachments} />
          {state.chatStatus ? <ChatStatusIndicator busy={state.chatStatus.busy} color={state.chatStatus.color} /> : null}
          <div className={`${styles.editorShell} tiptap-wrapper tiptap-input tiptap-input-chat`}>
            <div className={`${styles.editor} ProseMirror`} contentEditable={!state.disabled} suppressContentEditableWarning>
              <p>
                <span className={state.text ? styles.text : styles.placeholder}>
                  {state.text ? <ComposerText state={state} /> : state.placeholder}
                </span>
              </p>
            </div>
          </div>
          {state.revertHistory ? <RevertHistoryPopup state={state.revertHistory} /> : null}
          {state.commandSuggestion ? <CommandSuggestionPopup state={state.commandSuggestion} /> : null}
          {state.referenceAutocomplete ? <ReferenceAutocomplete state={state.referenceAutocomplete} /> : null}
          <ComposerActionBar
            busy={state.busy}
            disabled={state.disabled}
            forcedMode={state.forcedMode}
            mode={state.mode}
            modeOptions={state.modeOptions}
            openSelector={state.openSelector}
            phase={state.phase}
            referenceButtonPressed={state.referenceButtonPressed}
            quickPrompts={state.quickPrompts}
            quickPromptsButtonPressed={state.quickPromptsButtonPressed}
            quickPromptsEditing={state.quickPromptsEditing}
            quickPromptsEditingId={state.quickPromptsEditingId}
            quickPromptsEditingText={state.quickPromptsEditingText}
            quickPromptsNewText={state.quickPromptsNewText}
            quickPromptsOpen={state.quickPromptsOpen}
            quickPromptsSelectedIndex={state.quickPromptsSelectedIndex}
            recording={state.recording}
            sendDisabled={sendDisabled}
            sendPressed={state.sendPressed}
            speechSupported={state.speechSupported}
          />
          {state.statusLine ? <div className={styles.statusLine}>{state.statusLine}</div> : null}
        </div>
      </form>
      {state.bottomTabs ? <BottomThreadTabs {...state.bottomTabs} /> : null}
    </footer>
  );
}

function ChatStatusIndicator({busy, color}: {busy?: boolean; color: string}) {
  const dotStyle = busy ? undefined : {backgroundColor: color};
  return (
    <div className={styles.statusIndicator}>
      <span className={styles.statusIndicatorDotWrap}>
        <span className={busy ? styles.statusIndicatorDotBusy : styles.statusIndicatorDot} style={dotStyle} />
        <span className={busy ? styles.statusIndicatorGlowBusy : styles.statusIndicatorGlow} style={dotStyle} />
      </span>
    </div>
  );
}

function ComposerText({state}: {state: ChatComposerState}) {
  if (!state.content?.length) return <>{state.text ?? ''}</>;
  return (
    <>
      {state.content.map((node, index) => {
        if (node.type === 'text') return <span key={`text-${index}`}>{node.text}</span>;
        return <ReferencePill key={node.refId} label={node.label} refType={node.refType} selected={node.selected} />;
      })}
    </>
  );
}
