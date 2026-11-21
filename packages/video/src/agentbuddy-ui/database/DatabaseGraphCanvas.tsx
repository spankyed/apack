import {DatabaseGraphExplorer} from './DatabaseGraphExplorer';
import {QueryEditorPanel} from './QueryEditorPanel';
import {SchemaPanel} from './SchemaPanel';
import {makeStyles} from '../primitives/makeStyles';
import type {DatabaseSurfaceState} from './databaseTypes';
import './DatabaseGraphCanvas.module.css';

const styles = makeStyles('DatabaseGraphCanvas');

type DatabaseGraphCanvasProps = {
  state: DatabaseSurfaceState;
};

export function DatabaseGraphCanvas({state}: DatabaseGraphCanvasProps) {
  return (
    <div className={styles.root}>
      <div className={styles.schemaPanel}>
        <SchemaPanel
          expandedCategoryIds={state.expandedSchemaCategoryIds}
          isRefreshing={state.isSchemaRefreshing}
          schema={state.schema}
          searchQuery={state.searchQuery}
          selectedItemId={state.selectedSchemaItemId}
        />
        <div className={styles.resizeHandle}><div /></div>
      </div>
      <div className={styles.main}>
        <div className={styles.queryPanel}>
          <QueryEditorPanel state={state} />
          <div className={styles.resizeHandle}><div /></div>
        </div>
        <div className={styles.graphPanel}>
          <DatabaseGraphExplorer state={state.graph ?? {currentLayout: 'd3-force', edges: [], nodes: [], zoomLevel: 1}} />
        </div>
      </div>
    </div>
  );
}
