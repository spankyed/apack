import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import type {DatabaseSurfaceState} from './databaseTypes';
import './ModeTabs.module.css';

const styles = makeStyles('DatabaseModeTabs');

type ModeTabsProps = {
  activeMode: DatabaseSurfaceState['activeMode'];
};

const modes = [
  {value: 'query' as const, label: 'Query'},
  {value: 'examples' as const, label: 'Examples'},
];

export function ModeTabs({activeMode}: ModeTabsProps) {
  return (
    <div className={styles.root}>
      {modes.map((mode, index) => (
        <button className={cx(styles.button, index > 0 && styles.buttonBorder, activeMode === mode.value ? styles.active : styles.inactive)} key={mode.value} type="button">
          {mode.label}
        </button>
      ))}
    </div>
  );
}
