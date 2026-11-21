import {makeStyles} from '../primitives/makeStyles';
import './PrimitiveResultsTable.module.css';

const styles = makeStyles('DatabasePrimitiveResultsTable');

type PrimitiveResultsTableProps = {
  values: unknown[];
};

// Mirrors packages/renderer/src/plugins/database/components/simple-table/components/PrimitivesTable.vue.
export function PrimitiveResultsTable({values}: PrimitiveResultsTableProps) {
  return (
    <div className={styles.root}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {values.map((value, index) => (
            <tr key={index}>
              <td>
                <div title={String(value)}>{String(value)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
