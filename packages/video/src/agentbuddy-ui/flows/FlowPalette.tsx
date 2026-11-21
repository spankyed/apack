import type {CSSProperties} from 'react';
import {FlowPaletteItem} from './FlowPaletteItem';
import type {FlowPaletteItemState} from './flowTypes';
import './FlowPalette.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('FlowPalette');

// Mirrors packages/renderer/src/plugins/flows/canvas/components/NodePalette.vue.
export function FlowPalette({items, style}: {items: FlowPaletteItemState[]; style?: CSSProperties}) {
  return (
    <aside className={styles.root} style={style}>
      <div className={styles.inner} data-onboarding-id="flow-node-palette">
        <div className={styles.stack}>
          {items.map(item => <FlowPaletteItem key={item.kind} item={item} />)}
        </div>
      </div>
    </aside>
  );
}
