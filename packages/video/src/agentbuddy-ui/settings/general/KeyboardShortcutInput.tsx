import {Icons} from '../../primitives/Icon';
import './KeyboardShortcutInput.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const styles = makeStyles('KeyboardShortcutInput');

export type KeyboardShortcutValue =
  | string
  | {
      global?: boolean;
      key?: string;
      modifiers?: string[];
    }
  | null;

export function KeyboardShortcutInput({emptyText = 'Not set', label, value, showResetButton = true}: {
  emptyText?: string;
  label?: string;
  placeholder?: string;
  showResetButton?: boolean;
  value?: KeyboardShortcutValue;
}) {
  const displayValue = formatShortcut(value, emptyText);
  const tooltipValue = formatShortcutTooltip(value);
  const isEmpty = displayValue === emptyText;
  const isGlobal = typeof value === 'object' && value !== null && value.global === true;

  return (
    <div className={styles.root}>
      <span className={styles.box} title={tooltipValue}>
        {label ? <span className={styles.label}>{label}</span> : null}
        {isGlobal && !isEmpty ? <span className={styles.globalBadge}>Global</span> : null}
        {!isEmpty ? <span className={styles.key}>{displayValue}</span> : <span className={styles.empty}>{emptyText}</span>}
        {isEmpty ? <Icons.Keyboard className={styles.keyboardIcon} size={16} /> : null}
      </span>
      {!isEmpty && showResetButton ? (
        <button className={styles.resetButton} title="Clear shortcut" type="button">
          <Icons.Eraser size={16} />
        </button>
      ) : null}
    </div>
  );
}

function formatShortcut(value: KeyboardShortcutValue | undefined, emptyText: string) {
  if (!value) return emptyText;
  if (typeof value === 'string') return value;

  const parts = modifierParts(value.modifiers ?? []);
  const key = formatKey(value.key ?? '');
  if (key) parts.push(key);
  return parts.length > 0 ? parts.join(' ') : emptyText;
}

function formatShortcutTooltip(value: KeyboardShortcutValue | undefined) {
  if (!value) return '';
  if (typeof value === 'string') return value;

  const parts = plainModifierParts(value.modifiers ?? []);
  const key = formatKeyPlainText(value.key ?? '');
  if (key) parts.push(key);
  return parts.length > 0 ? parts.join(' + ') : '';
}

function modifierParts(modifiers: string[]) {
  const parts: string[] = [];
  if (modifiers.includes('cmd')) parts.push('⌘');
  if (modifiers.includes('ctrl')) parts.push('⌃');
  if (modifiers.includes('option') || modifiers.includes('alt')) parts.push('⌥');
  if (modifiers.includes('shift')) parts.push('⇧');
  return parts;
}

function plainModifierParts(modifiers: string[]) {
  const parts: string[] = [];
  if (modifiers.includes('cmd')) parts.push('Command');
  if (modifiers.includes('ctrl')) parts.push('Control');
  if (modifiers.includes('option') || modifiers.includes('alt')) parts.push('Option/Alt');
  if (modifiers.includes('shift')) parts.push('Shift');
  return parts;
}

function formatKey(key: string) {
  const keyMap: Record<string, string> = {
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    Backspace: '⌫',
    Delete: '⌦',
    End: 'End',
    Enter: '⏎',
    Escape: 'Esc',
    Home: 'Home',
    PageDown: 'PgDn',
    PageUp: 'PgUp',
    Tab: '⇥',
    ' ': 'Space',
  };

  if (key.includes('+')) {
    return key.split('+').map(part => keyMap[part] || part.toUpperCase()).join(' ');
  }

  return keyMap[key] || key.toUpperCase();
}

function formatKeyPlainText(key: string) {
  const keyMap: Record<string, string> = {
    ArrowDown: 'Down Arrow',
    ArrowLeft: 'Left Arrow',
    ArrowRight: 'Right Arrow',
    ArrowUp: 'Up Arrow',
    Backspace: 'Backspace',
    Delete: 'Delete',
    End: 'End',
    Enter: 'Enter',
    Escape: 'Escape',
    Home: 'Home',
    PageDown: 'Page Down',
    PageUp: 'Page Up',
    Tab: 'Tab',
    ' ': 'Space',
  };

  if (key.includes('+')) {
    return key.split('+').map(part => keyMap[part] || part.toUpperCase()).join(' + ');
  }

  return keyMap[key] || key.toUpperCase();
}
