import {MonacoCodeViewer} from '../code/MonacoCodeViewer';
import {makeStyles} from '../primitives/makeStyles';
import type {DatabaseSurfaceState} from './databaseTypes';
import {QueryEditorExamples} from './QueryEditorExamples';
import {QueryEditorHeader} from './QueryEditorHeader';
import './QueryEditorPanel.module.css';

const styles = makeStyles('DatabaseQueryEditorPanel');

type QueryEditorPanelProps = {
  state: DatabaseSurfaceState;
};

export function QueryEditorPanel({state}: QueryEditorPanelProps) {
  return (
    <div className={styles.root}>
      <QueryEditorHeader state={state} />

      {state.isAiPromptOpen ? (
        <div className={styles.aiPrompt}>
          <textarea placeholder="Describe what you want to query..." readOnly rows={1} value={state.aiPrompt ?? ''} />
          {(state.aiPrompt ?? '').trim() ? <button type="button">↵</button> : null}
        </div>
      ) : null}

      <div className={styles.editorRegion}>
        {state.activeMode === 'query' ? (
          <>
            <MonacoCodeViewer filePath="database-query.ts" fontSize={14} height="100%" language="typescript" lineNumbers="on" value={state.currentQuery} wordWrap="on" />
            {state.isAiQueryLoading ? (
              <div className={styles.loadingOverlay}>
                <div className={styles.loadingBody}>
                  <div className={styles.spinner} />
                  <div>Generating {state.mode === 'transaction' ? 'transaction' : 'query'} from prompt...</div>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <QueryEditorExamples examples={state.examples} />
        )}
      </div>
    </div>
  );
}
