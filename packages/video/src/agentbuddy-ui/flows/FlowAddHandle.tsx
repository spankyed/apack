import {makeStyles} from '../primitives/makeStyles';
import './FlowAddHandle.module.css';

const styles = makeStyles('FlowAddHandle');

// Mirrors packages/renderer/src/plugins/flows/canvas/nodes/AddHandle.vue.
export function FlowAddHandle({selected}: {selected?: boolean}) {
  return <span className={selected ? styles.selected : styles.root}>+</span>;
}
