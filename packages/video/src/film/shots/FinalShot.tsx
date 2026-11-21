import {finalShotViewForFrame} from '../state/final';
import './FinalShot.module.css';
import {makeStyles} from '../../agentbuddy-ui/primitives/makeStyles';
const styles = makeStyles('FinalShot');

export function FinalShot({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const view = finalShotViewForFrame(frame);
  return (
    <div className={`${styles.root} ${variant === 'square' ? styles.square : ''}`}>
      <div className={styles.lockup}>
        <h1 className={styles.title} style={view.titleStyle}>{view.brand}</h1>
        <p className={styles.sub} style={view.taglineStyle}>{view.tagline}</p>
      </div>
    </div>
  );
}
