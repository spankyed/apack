import type {CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import type {ChatComposerState} from './chatTypes';
import {cx} from '../primitives/classNames';
import './ChatComposer.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('ChatComposer');

type CommandSuggestionState = NonNullable<ChatComposerState['commandSuggestion']>;

/*
 * Mirrors packages/renderer/src/core/components/tiptap/CommandSuggestionPopup.vue.
 * Positioned popups are portaled to body, like Vue's Teleport, so fixed
 * coordinates are not captured by transformed film wrappers.
 */
export function CommandSuggestionPopup({state}: {state: CommandSuggestionState}) {
  const popup = (
    <div className={cx(styles.commandSuggestionPopup, 'command-suggestion-popup')} style={commandSuggestionStyleForState(state)}>
      {state.suggestions.map((command, index) => (
        <div className={commandSuggestionItemClassName(index === (state.activeIndex ?? 0))} key={command.name}>
          <span className={cx(styles.commandSuggestionName, 'command-suggestion-name')}>/{command.name}</span>
        </div>
      ))}
      {state.suggestions.length === 0 ? <div className={cx(styles.commandSuggestionEmpty, 'command-suggestion-empty')}>No matching commands</div> : null}
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(popup, document.body);
  }

  return popup;
}

function commandSuggestionItemClassName(selected: boolean) {
  return cx(
    selected ? styles.commandSuggestionItemActive : styles.commandSuggestionItem,
    'command-suggestion-item',
    selected && 'is-selected',
  );
}

function commandSuggestionStyleForState(state: CommandSuggestionState): CSSProperties {
  const position = state.popupPosition;
  if (position) {
    return {
      bottom: position.bottom == null ? 'auto' : `${position.bottom}px`,
      left: `${position.left}px`,
      position: 'fixed',
      top: position.top == null ? 'auto' : `${position.top}px`,
    };
  }

  return {
    bottom: '0px',
    left: '0px',
    position: 'fixed',
  };
}
