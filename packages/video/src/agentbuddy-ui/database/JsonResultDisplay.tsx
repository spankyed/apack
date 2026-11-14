import {MonacoCodeViewer} from '../code/MonacoCodeViewer';
import {makeStyles} from '../primitives/makeStyles';
import './JsonResultDisplay.module.css';

const styles = makeStyles('DatabaseJsonResultDisplay');

type JsonResultDisplayProps = {
  data: unknown;
};

// Mirrors packages/renderer/src/plugins/database/components/simple-table/components/JsonDisplay.vue.
export function JsonResultDisplay({data}: JsonResultDisplayProps) {
  return (
    <div className={styles.root}>
      <div className={styles.editorFrame}>
        <MonacoCodeViewer filePath="database-result.json" fontSize={14} height="100%" language="json" lineNumbers="on" value={JSON.stringify(data, null, 2)} wordWrap="on" />
      </div>
    </div>
  );
}
