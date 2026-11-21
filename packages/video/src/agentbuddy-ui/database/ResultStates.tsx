import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './ResultStates.module.css';

const styles = makeStyles('DatabaseResultStates');

type ResultStatesProps = {
  error?: string | null;
  state: 'empty-array' | 'error' | 'loading' | 'no-results';
};

export function ResultStates({error, state}: ResultStatesProps) {
  if (state === 'loading') {
    return <div className={styles.center}><div className={styles.muted}>Loading...</div></div>;
  }
  if (state === 'error') {
    return (
      <div className={styles.center}>
        <div className={styles.error}>
          <div>Query Error</div>
          <p>{error}</p>
        </div>
      </div>
    );
  }
  if (state === 'empty-array') {
    return <div className={styles.center}><div className={styles.muted}>Empty array returned</div></div>;
  }
  return (
    <div className={styles.center}>
      <div className={styles.noResults}>
        <Icons.Database size={64} />
        <p>Execute a query to see the results</p>
      </div>
    </div>
  );
}
