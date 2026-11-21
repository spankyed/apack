import type {CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {ReferenceIcon} from './ReferencePill';
import {referenceCategoryLabel} from './referenceConfig';
import type {ChatComposerState} from './chatTypes';
import {cx} from '../primitives/classNames';
import './ChatComposer.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('ChatComposer');

type ReferenceAutocompleteState = NonNullable<ChatComposerState['referenceAutocomplete']>;

/*
 * Mirrors packages/renderer/src/core/components/tiptap/ReferenceSuggestionPopup.vue.
 * Positioned popups are portaled to body, like Vue's Teleport, so fixed
 * coordinates are not captured by transformed film wrappers.
 */
export function ReferenceAutocomplete({state}: {state: ReferenceAutocompleteState}) {
  const activeCategoryLabel = referenceCategoryLabel(state.selectedCategory);
  const popup = state.level === 'items' ? (
    <div className={cx(styles.referenceAutocomplete, 'reference-suggestion-popup')} style={referenceAutocompleteStyleForState(state)}>
      <div className={cx(styles.referenceSuggestionHeader, 'reference-suggestion-header')}>
        <span className={cx(styles.referenceSuggestionBack, 'reference-suggestion-back')}>←</span>
        <span>{activeCategoryLabel}</span>
      </div>
      {state.suggestions.map((suggestion, index) => (
        <div className={referenceSuggestionClassName(state.selectedIndex, index)} key={suggestion.id}>
          <ReferenceIcon className="reference-suggestion-icon" tone="suggestion" refType={suggestion.type} />
          <span className={cx(styles.referenceSuggestionLabel, 'reference-suggestion-label')}>{suggestion.label}</span>
          <span className={cx(styles.referenceSuggestionCode, 'reference-suggestion-code')} title={suggestion.shortCode}>{shortReferenceCode(suggestion.shortCode)}</span>
        </div>
      ))}
      {state.suggestions.length === 0 ? <div className={cx(styles.referenceSuggestionEmpty, 'reference-suggestion-empty')}>No matching items</div> : null}
    </div>
  ) : (
    <div className={cx(styles.referenceAutocomplete, 'reference-suggestion-popup')} style={referenceAutocompleteStyleForState(state)}>
      {state.suggestions.map((suggestion, index) => (
        <div className={referenceSuggestionClassName(state.selectedIndex, index)} key={suggestion}>
          <ReferenceIcon className="reference-suggestion-icon" tone="suggestion" refType={suggestion} />
          <span>{referenceCategoryLabel(suggestion)}</span>
        </div>
      ))}
      {state.suggestions.length === 0 ? <div className={cx(styles.referenceSuggestionEmpty, 'reference-suggestion-empty')}>No matching categories</div> : null}
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(popup, document.body);
  }

  return popup;
}

function referenceAutocompleteStyleForState(state: ReferenceAutocompleteState): CSSProperties {
  const position = state.popupPosition;
  if (!position) {
    return {
      bottom: '0px',
      left: '0px',
      position: 'fixed',
    };
  }

  const isFullEditor = state.variant === 'full';
  return {
    bottom: position.bottom == null || isFullEditor && position.top != null ? 'auto' : `${position.bottom}px`,
    left: `${position.left}px`,
    position: 'fixed',
    top: position.top == null ? 'auto' : `${position.top}px`,
  };
}

function isActiveReferenceSuggestion(selectedIndex: number | undefined, index: number) {
  return index === (selectedIndex ?? 0);
}

function referenceSuggestionClassName(selectedIndex: number | undefined, index: number) {
  return cx(
    isActiveReferenceSuggestion(selectedIndex, index) ? styles.referenceSuggestionActive : styles.referenceSuggestion,
    'reference-suggestion-item',
    isActiveReferenceSuggestion(selectedIndex, index) && 'is-selected',
  );
}

function shortReferenceCode(shortCode: string) {
  return shortCode.length > 12 ? `${shortCode.slice(0, 12)}…` : shortCode;
}
