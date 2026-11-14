import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {ActionParameter} from './actionTypes';
import {ParameterRow} from './ParameterRow';
import './ActionParametersEditor.module.css';

const styles = makeStyles('ActionsParametersEditor');

type ActionParametersEditorProps = {
  expandedKeys?: string[];
  parameters: Record<string, ActionParameter>;
};

export function ActionParametersEditor({expandedKeys = [], parameters}: ActionParametersEditorProps) {
  const entries = Object.entries(parameters);
  const expanded = new Set(expandedKeys);
  return (
    <div className={styles.root}>
      {entries.length > 0 ? (
        <div className={styles.parameters}>
          {entries.map(([key, parameter]) => (
            <ParameterRow expanded={expanded.has(key)} key={key} parameter={parameter} paramKey={key} />
          ))}
        </div>
      ) : null}
      <button className={styles.addButton} data-onboarding-id="action-parameters-section" type="button">
        <Icons.Plus size={16} />
        Add Parameter
      </button>
    </div>
  );
}
