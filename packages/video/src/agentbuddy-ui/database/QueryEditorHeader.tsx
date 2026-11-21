import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import type {DatabaseSurfaceState} from './databaseTypes';
import {KeyboardHint} from './KeyboardHint';
import {ModeTabs} from './ModeTabs';
import {QueryEditorActions} from './QueryEditorActions';
import {QueryEditorMessages} from './QueryEditorMessages';
import './QueryEditorHeader.module.css';

const styles = makeStyles('DatabaseQueryEditorHeader');

type QueryEditorHeaderProps = {
  state: Pick<DatabaseSurfaceState, 'activeMode' | 'currentQuery' | 'error' | 'executePressed' | 'executeQueryShortcut' | 'isAiPromptOpen' | 'isLoading' | 'mode' | 'successMessage'>;
};

export function QueryEditorHeader({state}: QueryEditorHeaderProps) {
  return (
    <div className={styles.root}>
      <div className={styles.left}>
        <ModeTabs activeMode={state.activeMode} />
        <div className={styles.divider} />
        <button className={styles.iconButton} title="Clear query" type="button">
          <Icons.FileX size={16} />
        </button>
        <button className={cx(styles.iconButton, state.isAiPromptOpen && styles.aiActive)} title="Generate query with AI" type="button">
          <Icons.Wand2 size={16} />
        </button>
        <KeyboardHint executeQuery={state.executeQueryShortcut} />
      </div>

      <div className={styles.right}>
        <QueryEditorMessages error={state.error} successMessage={state.successMessage} />
        <QueryEditorActions executePressed={state.executePressed} isDisabled={!state.currentQuery.trim()} isLoading={state.isLoading} mode={state.mode} />
      </div>
    </div>
  );
}
