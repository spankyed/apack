import {Icons} from '../primitives/Icon';
import type {FlowPaletteItemState} from './flowTypes';
import './FlowPalette.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('FlowPalette');

const iconByKind = {
  action: Icons.Play,
  create: Icons.Plus,
  keep_alive: Icons.Activity,
  listener: Icons.Radio,
  schedule: Icons.Clock,
  llm: Icons.Sparkle,
  flow: Icons.Flows,
  switch: Icons.Split,
  fire: Icons.Zap,
  kill: Icons.Plug,
  entry: Icons.Radio,
  event: Icons.Radio,
};

// Mirrors packages/renderer/src/plugins/flows/canvas/components/NodePalette.vue.
export function FlowPaletteItem({item}: {item: FlowPaletteItemState}) {
  const Icon = iconByKind[item.kind];
  return (
    <button className={styles.item} data-disabled={item.disabled ? 'true' : undefined} data-kind={item.kind} data-pressed={item.pressed ? 'true' : undefined} type="button">
      {!item.disabled ? <span className={styles.glow} /> : null}
      <span className={styles.content}>
        <span className={styles.dot} />
        <span className={styles.label}>{item.label}</span>
        <Icon className={styles.icon} size={14} />
      </span>
      <span className={styles.gradientOverlay} />
    </button>
  );
}
