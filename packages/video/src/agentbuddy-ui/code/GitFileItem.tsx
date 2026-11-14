import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import './GitFileItem.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('GitFileItem');

export type GitFile = {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
};

type GitFileAction = 'discard' | 'stage' | 'unstage';

export function GitFileItem({actions = [], file, selected}: {actions?: GitFileAction[]; file: GitFile; selected?: boolean}) {
  const slash = file.path.lastIndexOf('/');
  const filename = slash === -1 ? file.path : file.path.slice(slash + 1);
  const directory = slash === -1 ? '' : file.path.slice(0, slash);
  const status = file.status === 'modified' ? 'M' : file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : file.status === 'renamed' ? 'R' : 'U';
  return (
    <div className={cx(styles.root, selected && styles.selected)}>
      <div className={styles.nameWrap}>
        <span className={styles.filename}>{filename}</span>
        {directory ? <span className={styles.directory}>{directory}</span> : null}
      </div>
      <span className={cx(styles.status, file.status === 'added' && styles.added)}>{status}</span>
      {file.status !== 'deleted' ? <button className={styles.openAction} title="Open file"><Icons.File size={14} /></button> : null}
      {actions.map(action => (
        <button key={action} className={styles.action} title={actionLabel(action)}>
          {action === 'discard' ? <Icons.RotateCcw size={14} /> : action === 'unstage' ? <Icons.Minus size={14} /> : <Icons.Plus size={14} />}
        </button>
      ))}
    </div>
  );
}

function actionLabel(action: GitFileAction) {
  if (action === 'discard') return 'Discard changes';
  if (action === 'stage') return 'Stage';
  return 'Unstage';
}
