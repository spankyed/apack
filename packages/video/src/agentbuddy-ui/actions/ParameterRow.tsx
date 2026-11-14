import type {ActionParameter, ActionParameterType} from './actionTypes';
import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import './ParameterRow.module.css';

const styles = makeStyles('ActionsParameterRow');

type ParameterRowProps = {
  expanded?: boolean;
  paramKey: string;
  parameter: ActionParameter;
};

const parameterTypes: ActionParameterType[] = ['any', 'string', 'number', 'boolean', 'object', 'array'];

export function ParameterRow({expanded = false, parameter, paramKey}: ParameterRowProps) {
  return (
    <div className={styles.root}>
      <div className={styles.mainRow}>
        <button className={styles.expandButton} title={expanded ? 'Collapse' : 'Expand options'} type="button">
          <Icons.ChevronDown className={cx(styles.expandIcon, !expanded && styles.collapsedIcon)} size={16} />
        </button>
        <input className={styles.keyInput} placeholder="Parameter key" readOnly type="text" value={paramKey} />
        <select className={styles.typeSelect} value={parameter.type}>
          {parameterTypes.map(type => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <label className={styles.requiredLabel}>
          <input checked={parameter.required === true} readOnly type="checkbox" />
          Required
        </label>
        <button className={styles.removeButton} title="Remove parameter" type="button">
          <Icons.X size={16} />
        </button>
      </div>
      {expanded ? (
        <div className={styles.descriptionRow}>
          <label>Description</label>
          <input className={styles.descriptionInput} placeholder="Parameter description" readOnly type="text" value={parameter.description ?? ''} />
        </div>
      ) : null}
    </div>
  );
}
