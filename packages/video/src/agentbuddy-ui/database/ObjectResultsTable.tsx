import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {DatabaseResultRow} from './databaseTypes';
import './ObjectResultsTable.module.css';

const styles = makeStyles('DatabaseObjectResultsTable');

type ObjectResultsTableProps = {
  copiedRowIndex?: number;
  headers: string[];
  rows: DatabaseResultRow[];
};

// Mirrors packages/renderer/src/plugins/database/components/simple-table/components/ObjectsTable.vue.
export function ObjectResultsTable({copiedRowIndex, headers, rows}: ObjectResultsTableProps) {
  return (
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
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {headers.map(header => (
                <td key={header}>
                  <div className={styles.cell} title={formatCellValue(row[header])}>{formatCellValue(row[header])}</div>
                </td>
              ))}
              {copiedRowIndex === rowIndex ? (
                <div className={styles.copied}>
                  <div className={styles.copiedInner}>
                    <Icons.ClipboardList size={16} />
                    <span>Copied</span>
                  </div>
                </div>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCellValue(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
