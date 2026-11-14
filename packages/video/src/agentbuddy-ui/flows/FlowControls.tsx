import type {CSSProperties} from 'react';
import {Icons} from '../primitives/Icon';
import './FlowCanvas.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('FlowCanvas');

export function FlowControls({style}: {style?: CSSProperties}) {
  return (
    <button className={styles.controls} style={style} type="button" title="Auto layout">
      <Icons.Maximize size={16} />
    </button>
  );
}
