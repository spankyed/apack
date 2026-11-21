import {makeStyles} from '../primitives/makeStyles';
import {Icons} from '../primitives/Icon';
import './ResultsInfoBar.module.css';

const styles = makeStyles('DatabaseResultsInfoBar');

type ResultsInfoBarProps = {
  executionTime: number | null;
  resultCount: number;
  resultType: 'array' | 'object' | 'primitive';
  hasResult: boolean;
};

export function ResultsInfoBar({executionTime, hasResult, resultCount, resultType}: ResultsInfoBarProps) {
  return (
    <div className={styles.root}>
      <div className={styles.inner}>
        <div className={styles.left}>
          <div className={styles.count}>
            {!hasResult ? (
              <>
                <Icons.List size={14} />
                <span>No results</span>
              </>
            ) : resultType === 'array' ? (
              <>
                <strong>{resultCount.toLocaleString()}</strong>
                <span>{resultCount === 1 ? 'result' : 'results'}</span>
              </>
            ) : (
              <span>{resultType === 'object' ? 'Object result' : 'Primitive value'}</span>
            )}
          </div>
          {hasResult ? (
            <div className={styles.type}>
              <Icons.Code size={12} />
              {resultType}
            </div>
          ) : null}
        </div>
        {executionTime !== null ? (
          <div className={styles.time}>
            <Icons.Clock size={14} />
            <span>{formatExecutionTime(executionTime)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatExecutionTime(time: number) {
  if (time < 1) return `${time.toFixed(3)}ms`;
  if (time < 1000) return `${time.toFixed(2)}ms`;
  return `${(time / 1000).toFixed(3)}s`;
}
