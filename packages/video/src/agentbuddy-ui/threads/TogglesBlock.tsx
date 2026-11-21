import {makeStyles} from '../primitives/makeStyles';
import type {TogglesBlockState} from './threadTypes';
import './TogglesBlock.module.css';

const styles = makeStyles('TogglesBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/blocks/TogglesBlock.vue.
export function TogglesBlock({state}: {state: TogglesBlockState}) {
  const responseToggles = responseValues(state.response);
  if (state.disabled && responseToggles) {
    return (
      <div className={styles.response}>
        {Object.entries(responseToggles).map(([id, value]) => (
          <span className={styles.responseItem} key={id}>
            {labelFor(id, state)}: <span className={value ? styles.on : styles.off}>{value ? 'On' : 'Off'}</span>
          </span>
        ))}
      </div>
    );
  }
  if (state.disabled) {
    return <div className={styles.empty} />;
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

function responseValues(response: TogglesBlockState['response']) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  if ('toggles' in response && response.toggles && typeof response.toggles === 'object' && !Array.isArray(response.toggles)) {
    return response.toggles as Record<string, boolean>;
  }
  return null;
}
