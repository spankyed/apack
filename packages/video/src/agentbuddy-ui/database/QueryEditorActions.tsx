import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import type {DatabaseSurfaceState} from './databaseTypes';
import './QueryEditorActions.module.css';

const styles = makeStyles('DatabaseQueryEditorActions');

type QueryEditorActionsProps = {
  executePressed?: boolean;
  isDisabled: boolean;
  isLoading: boolean;
  mode: DatabaseSurfaceState['mode'];
};

export function QueryEditorActions({executePressed, isDisabled, isLoading, mode}: QueryEditorActionsProps) {
  const ModeIcon = mode === 'query' ? Icons.Database : Icons.Edit3;
  const ExecuteIcon = isLoading ? Icons.Loader2 : Icons.Play;
  return (
    <div className={styles.root}>
      <button className={cx(styles.modeButton, mode === 'query' ? styles.queryMode : styles.transactionMode)} title={`Switch to ${mode === 'query' ? 'Transaction' : 'Query'} mode`} type="button">
        <ModeIcon size={14} />
        <span>{mode === 'query' ? 'Query' : 'Transaction'}</span>
      </button>
      <div className={styles.divider} />
      <button className={styles.executeButton} data-disabled={isDisabled || isLoading} data-pressed={executePressed || undefined} disabled={isDisabled || isLoading} type="button">
        <ExecuteIcon className={isLoading ? styles.spinner : undefined} size={14} />
        <span>{isLoading ? 'Running...' : 'Execute'}</span>
      </button>
    </div>
  );
}
