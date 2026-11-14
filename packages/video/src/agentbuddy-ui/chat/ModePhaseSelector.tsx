import {Icons} from '../primitives/Icon';
import type {ChatModeOption} from './chatTypes';
import './ModePhaseSelector.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('ModePhaseSelector');

type ModePhaseSelectorProps = {
  disabled?: boolean;
  mode: string;
  modeOptions?: ChatModeOption[];
  openSelector?: 'mode' | 'phase';
  phase?: string;
};

// Mirrors packages/renderer/src/plugins/threads/chat/ModePhaseSelector.vue.
export function ModePhaseSelector({disabled, mode, modeOptions = [], openSelector, phase}: ModePhaseSelectorProps) {
  const visibleModes = modeOptions.filter(option => !option.hidden);
  const currentMode = visibleModes.find(option => option.name === mode);
  const phases = currentMode?.phases ?? [];
  const currentPhase = phases.find(option => option.name === phase);
  return (
    <div className={styles.root}>
      <button className={styles.mode} disabled={disabled} type="button">
        <span>{mode}</span>
        <Icons.ChevronDown className={openSelector === 'mode' ? styles.chevronUp : styles.chevronDown} size={14} />
      </button>
      {phase ? (
        <>
          <span className={styles.divider} />
          <button
            className={styles.phase}
            disabled={disabled}
            style={currentPhase?.color ? {backgroundColor: `${currentPhase.color}33`} : undefined}
            type="button"
          >
            <span>{phase}</span>
            <Icons.ChevronDown className={openSelector === 'phase' ? styles.chevronUp : styles.chevronDown} size={14} />
          </button>
        </>
      ) : null}
      {openSelector === 'mode' && visibleModes.length > 0 ? (
        <div className={styles.modeMenu}>
          {visibleModes.map(option => (
            <div className={option.disabled ? styles.menuItemDisabled : styles.menuItem} key={option.name}>
              <span>{option.name}</span>
              {option.name === mode ? <Icons.Check className={styles.check} size={16} /> : null}
            </div>
          ))}
        </div>
      ) : null}
      {openSelector === 'phase' && phases.length > 0 ? (
        <div className={styles.phaseMenu}>
          {phases.map(option => (
            <div
              className={option.name === phase ? styles.menuItemActive : styles.menuItem}
              key={option.name}
              style={option.color ? {backgroundColor: `${option.color}33`} : undefined}
            >
              <span>{option.name}</span>
              {option.name === phase ? <Icons.Check className={styles.check} size={16} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
