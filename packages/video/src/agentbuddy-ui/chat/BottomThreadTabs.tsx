import {Icons} from '../primitives/Icon';
import './ChatComposer.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('ChatComposer');

export function BottomThreadTabs({activeLabel, newThreadLabel, recentLabel}: {activeLabel: string; newThreadLabel: string; recentLabel: string}) {
  return (
    <div className={styles.bottomTabs}>
      <span><Icons.Clock size={14} />{recentLabel}</span>
      <span><Icons.Square size={14} />{activeLabel}</span>
      <span><Icons.Plus size={14} />{newThreadLabel}</span>
    </div>
  );
}
