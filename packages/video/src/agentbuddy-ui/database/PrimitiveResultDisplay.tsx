import {makeStyles} from '../primitives/makeStyles';
import './PrimitiveResultDisplay.module.css';

const styles = makeStyles('DatabasePrimitiveResultDisplay');

type PrimitiveResultDisplayProps = {
  value: unknown;
};

// Mirrors packages/renderer/src/plugins/database/components/simple-table/components/PrimitiveDisplay.vue.
export function PrimitiveResultDisplay({value}: PrimitiveResultDisplayProps) {
  return (
    <div className={styles.root}>
      <div className={styles.value}>{String(value)}</div>
    </div>
  );
}
