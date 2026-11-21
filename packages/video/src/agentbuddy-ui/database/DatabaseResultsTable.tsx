import type {DatabaseResultRow} from './databaseTypes';
import {ResultStates} from './ResultStates';
import {ResultsInfoBar} from './ResultsInfoBar';
import {makeStyles} from '../primitives/makeStyles';
import './DatabaseResultsTable.module.css';

const styles = makeStyles('DatabaseResultsTable');

type DatabaseResultsTableProps = {
  error: string | null;
  executionTime: number | null;
  isLoading: boolean;
  rows: DatabaseResultRow[] | null;
};

export function DatabaseResultsTable({error, executionTime, isLoading, rows}: DatabaseResultsTableProps) {
  const currentState = getState({error, isLoading, rows});
  const headers = rows && rows.length > 0 ? collectHeaders(rows) : [];
  return (
    <div className={styles.root}>
      <div className={styles.tableContainer}>
        {currentState !== 'data' ? (
          <ResultStates error={error} state={currentState} />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {headers.map(header => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows?.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {headers.map(header => (
                      <td key={header}>
                        <div title={formatCellValue(row[header])}>{formatCellValue(row[header])}</div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ResultsInfoBar executionTime={executionTime} hasResult={Boolean(rows)} resultCount={rows?.length ?? 0} resultType="array" />
    </div>
  );
}

function getState({error, isLoading, rows}: Pick<DatabaseResultsTableProps, 'error' | 'isLoading' | 'rows'>): 'data' | 'empty-array' | 'error' | 'loading' | 'no-results' {
  if (isLoading) return 'loading';
  if (error) return 'error';
  if (!rows) return 'no-results';
  if (rows.length === 0) return 'empty-array';
  return 'data';
}

function formatCellValue(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function collectHeaders(rows: DatabaseResultRow[]) {
  const headers = new Set<string>();
  rows.forEach(row => {
    Object.keys(row).forEach(key => headers.add(key));
  });
  return Array.from(headers);
}
