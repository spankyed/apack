import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import './GitFileItem.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('GitFileItem');

export type GitFile = {
  originalPath?: string;
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied' | 'typechange' | 'unmerged';
};

type GitFileAction = 'discard' | 'stage' | 'unstage';

export function GitFileItem({actions = [], file, pressedAction, selected}: {actions?: GitFileAction[]; file: GitFile; pressedAction?: GitFileAction; selected?: boolean}) {
  const slash = file.path.lastIndexOf('/');
  const filename = slash === -1 ? file.path : file.path.slice(slash + 1);
  const directory = slash === -1 ? '' : file.path.slice(0, slash);
  const status = statusLabel(file.status);
  const displayName = file.status === 'renamed' && file.originalPath ? `${filenameFromPath(file.originalPath)} \u2192 ${filename}` : filename;
  return (
    <div className={cx(styles.root, selected && styles.selected)} title={file.status === 'renamed' && file.originalPath ? `${file.originalPath} \u2192 ${file.path}` : file.path}>
      <div className={styles.nameWrap}>
        <span className={styles.filename}>{displayName}</span>
        {directory ? <span className={styles.directory}>{directory}</span> : null}
      </div>
      <span className={cx(styles.status, styles[file.status])}>{status}</span>
      {file.status !== 'deleted' ? <button className={styles.openAction} title="Open file"><Icons.File size={12} /></button> : null}
      {actions.map(action => (
        <button key={action} className={styles.action} data-pressed={pressedAction === action || undefined} title={actionLabel(action)}>
          {action === 'discard' ? <Icons.RotateCcw size={12} /> : action === 'unstage' ? <Icons.Minus size={12} /> : <Icons.Plus size={12} />}
        </button>
      ))}
    </div>
  );
}

function filenameFromPath(path: string) {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

function statusLabel(status: GitFile['status']) {
  if (status === 'modified') return 'M';
  if (status === 'added') return 'A';
  if (status === 'deleted') return 'D';
  if (status === 'renamed') return 'R';
  if (status === 'copied') return 'C';
  if (status === 'typechange') return 'T';
  return 'U';
}

function actionLabel(action: GitFileAction) {
  if (action === 'discard') return 'Discard changes';
  if (action === 'stage') return 'Stage';
  return 'Unstage';
}
