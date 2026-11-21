import './WindowTrafficLights.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('WindowTrafficLights');

// Mirrors packages/renderer/src/core/components/layout/WindowControls.vue on macOS.
export function WindowTrafficLights() {
  return (
    <div className={styles.root}>
      <span className={styles.close} />
      <span className={styles.minimize} />
      <span className={styles.zoom} />
    </div>
  );
}

