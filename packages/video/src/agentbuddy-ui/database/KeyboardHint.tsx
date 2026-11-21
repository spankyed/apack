import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {DatabaseSurfaceState} from './databaseTypes';
import './KeyboardHint.module.css';

const styles = makeStyles('DatabaseKeyboardHint');

type KeyboardHintProps = {
  executeQuery?: DatabaseSurfaceState['executeQueryShortcut'];
};

export function KeyboardHint({executeQuery}: KeyboardHintProps) {
  return (
    <div className={styles.root}>
      <Icons.Keyboard size={12} />
      <span>{formatShortcut(executeQuery)} to run</span>
    </div>
  );
}

function formatShortcut(executeQuery: DatabaseSurfaceState['executeQueryShortcut']) {
  const platform = typeof navigator === 'undefined' ? 'Mac' : navigator.platform;
  const isMac = platform.toUpperCase().includes('MAC');
  if (!executeQuery) {
    return `${isMac ? 'Cmd' : 'Ctrl'} + Enter`;
  }

  const modifiers = executeQuery.modifiers.map(modifier => {
    switch (modifier.toLowerCase()) {
      case 'cmd':
      case 'command':
      case 'meta':
        return isMac ? 'Cmd' : 'Ctrl';
      case 'ctrl':
      case 'control':
        return 'Ctrl';
      case 'alt':
      case 'option':
        return isMac ? 'Option' : 'Alt';
      case 'shift':
        return 'Shift';
      default:
        return modifier;
    }
  });

  return [...modifiers, executeQuery.key === 'Enter' ? 'Enter' : executeQuery.key].join(' + ');
}
