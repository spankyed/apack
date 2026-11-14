import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './QueryEditorMessages.module.css';

const styles = makeStyles('DatabaseQueryEditorMessages');

type QueryEditorMessagesProps = {
  error: string | null;
  successMessage: string;
};

export function QueryEditorMessages({error, successMessage}: QueryEditorMessagesProps) {
  if (!error && !successMessage) return null;
  return (
    <div className={styles.root}>
      {error ? (
        <div className={styles.error}>
          <Icons.AlertCircle size={14} />
          <span>Query execution failed</span>
        </div>
      ) : (
        <div className={styles.success}>
          <Icons.CircleCheck size={14} />
          <span>{successMessage}</span>
        </div>
      )}
    </div>
  );
}
