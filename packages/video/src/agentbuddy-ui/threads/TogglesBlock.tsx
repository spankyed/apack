import {makeStyles} from '../primitives/makeStyles';
import type {TogglesBlockState} from './threadTypes';
import './TogglesBlock.module.css';

const styles = makeStyles('TogglesBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/blocks/TogglesBlock.vue.
export function TogglesBlock({state}: {state: TogglesBlockState}) {
  if (state.disabled && state.response) {
    return (
      <div className={styles.response}>
        {Object.entries(state.response).map(([id, value]) => (
          <span className={styles.responseItem} key={id}>
            {labelFor(id, state)}: <span className={value ? styles.on : styles.off}>{value ? 'On' : 'Off'}</span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {state.toggles.map(toggle => (
        <div className={styles.row} key={toggle.id}>
          <span className={toggle.default ? styles.switchOn : styles.switch}><span className={styles.knob} /></span>
          <span className={styles.label}>{toggle.label}</span>
          {toggle.description ? <span className={styles.description}>{toggle.description}</span> : null}
        </div>
      ))}
    </div>
  );
}

function labelFor(id: string, state: TogglesBlockState) {
  return state.toggles.find(toggle => toggle.id === id)?.label ?? id;
}
