import type {CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import type {ChatComposerState, RevertHistoryMessageState} from './chatTypes';
import './RevertHistoryPopup.module.css';

const styles = makeStyles('RevertHistoryPopup');

type RevertHistoryState = NonNullable<ChatComposerState['revertHistory']>;
type RevertActionId = 'revert' | 'revert-with-files' | 'summarize-from-here';

const actions: Array<{
  icon: typeof Icons.Undo2;
  id: RevertActionId;
  label: string;
}> = [
  {id: 'revert', label: 'Revert', icon: Icons.Undo2},
  {id: 'revert-with-files', label: 'Revert and rewind code', icon: Icons.FileCode2},
  {id: 'summarize-from-here', label: 'Summarize from here', icon: Icons.Sparkle},
];

/*
 * Mirrors packages/renderer/src/plugins/threads/chat/RevertHistoryPopup.vue.
 * Positioned popups are portaled to body, like Vue's Teleport, so fixed
 * coordinates are not captured by transformed film wrappers.
 */
export function RevertHistoryPopup({state}: {state: RevertHistoryState}) {
  if (state.messages.length === 0) return null;
  const level = state.level ?? 'messages';
  const selectedMessage = selectedMessageForState(state);

  const popup = (
    <div className={styles.root} style={revertHistoryStyle(state.popupPosition)}>
      {level === 'messages'
        ? state.messages.map(message => <MessageRow key={message.id} message={message} selected={message.id === selectedMessage?.id} />)
        : (
          <>
            {actions.map(action => (
              <ActionRow
                action={action}
                disabled={action.id === 'summarize-from-here' && selectedMessage?.canSummarize === false}
                key={action.id}
                selected={action.id === state.selectedAction}
              />
            ))}
            <div className={styles.hint}>
              <span className={styles.hintKey}>Enter</span>
              <span>confirm</span>
              <span className={styles.hintSep}>·</span>
              <span className={styles.hintKey}>←</span>
              <span>back</span>
            </div>
          </>
        )}
    </div>
  );

  if (state.popupPosition && typeof document !== 'undefined') {
    return createPortal(popup, document.body);
  }

  return popup;
}

function revertHistoryStyle(position: RevertHistoryState['popupPosition']): CSSProperties | undefined {
  if (!position) return undefined;
  return {
    bottom: `${position.bottom}px`,
    left: `${position.left}px`,
    maxWidth: `${position.maxWidth ?? 520}px`,
    position: 'fixed',
  };
}

function MessageRow({message, selected}: {message: RevertHistoryMessageState; selected?: boolean}) {
  return (
    <div className={selected ? styles.itemSelected : styles.item} title={message.text}>
      <span className={styles.time}>{formatTime(message.createdAt)}</span>
      <span className={styles.snippet}>{snippet(message.text)}</span>
      <Icons.ChevronRight className={styles.caret} size={14} />
    </div>
  );
}

function ActionRow({action, disabled, selected}: {action: typeof actions[number]; disabled?: boolean; selected?: boolean}) {
  const Icon = action.icon;
  const className = disabled
    ? cx(styles.itemDisabled, selected && styles.itemSelected)
    : selected ? styles.itemSelected : styles.item;
  return (
    <div className={className} title={disabled ? 'No prior assistant turn to summarize' : undefined}>
      <Icon className={styles.icon} size={14} />
      <span className={styles.snippet}>{action.label}</span>
    </div>
  );
}

function selectedMessageForState(state: RevertHistoryState) {
  if (state.selectedMessageId) return state.messages.find(message => message.id === state.selectedMessageId) ?? null;
  return state.messages.find(message => message.selected) ?? state.messages[state.messages.length - 1] ?? null;
}

function snippet(text: string) {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '(empty)';
  return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine;
}

function formatTime(createdAt?: number | string) {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}
