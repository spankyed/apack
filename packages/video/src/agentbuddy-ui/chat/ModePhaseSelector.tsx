import type {CSSProperties, ReactNode, RefObject} from 'react';
import {useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Icons} from '../primitives/Icon';
import type {ChatModeOption} from './chatTypes';
import './ModePhaseSelector.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('ModePhaseSelector');

type ModePhaseSelectorProps = {
  disabled?: boolean;
  forcedMode?: string;
  mode: string;
  modeOptions?: ChatModeOption[];
  openSelector?: 'mode' | 'phase';
  phase?: string;
};

// Mirrors packages/renderer/src/plugins/threads/chat/ModePhaseSelector.vue.
export function ModePhaseSelector({disabled, forcedMode, mode, modeOptions = [], openSelector, phase}: ModePhaseSelectorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const visibleModes = modeOptions.filter(option => !option.hidden);
  const currentMode = modeOptions.find(option => option.name === mode);
  const phases = currentMode?.phases ?? [];
  const currentPhase = phases.find(option => option.name === phase);
  const forcedModeName = modeOptions.find(option => option.name === forcedMode)?.name ?? 'Birth';
  const hasPhases = phases.length > 0;
  const currentModeName = currentMode?.name ?? 'Select mode';
  const currentPhaseName = currentPhase?.name ?? 'Select phase';
  if (forcedMode) {
    return (
      <div className={styles.rootForced}>
        <span>{forcedModeName}</span>
      </div>
    );
  }
  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.selector}>
        <button className={styles.mode} disabled={disabled} type="button">
          <span className={styles.buttonLabel}>{currentModeName}</span>
          <Icons.ChevronDown className={openSelector === 'mode' ? styles.chevronUp : styles.chevronDown} size={14} />
        </button>
        {hasPhases ? (
          <>
            <span className={styles.divider} />
            <button
              className={styles.phase}
              disabled={disabled}
              style={currentPhase?.color ? {backgroundColor: `${currentPhase.color}33`} : undefined}
              type="button"
            >
              <span className={styles.buttonLabel}>{currentPhaseName}</span>
              <Icons.ChevronDown className={openSelector === 'phase' ? styles.chevronUp : styles.chevronDown} size={14} />
            </button>
          </>
        ) : null}
      </div>
      {openSelector === 'mode' && visibleModes.length > 0 ? (
        <PortaledDropdown align="start" anchorRef={rootRef}>
        {style => <div className={styles.modeMenu} style={style}>
          {visibleModes.map(option => (
            <div className={option.disabled ? styles.menuItemDisabled : styles.menuItem} key={option.name}>
              <span className={styles.menuItemLabel}>{option.name}</span>
              {option.name === mode ? <Icons.Check className={styles.check} size={16} /> : null}
            </div>
          ))}
        </div>}
        </PortaledDropdown>
      ) : null}
      {openSelector === 'phase' && phases.length > 0 ? (
        <PortaledDropdown align="end" anchorRef={rootRef}>
        {style => <div className={styles.phaseMenu} style={style}>
          {phases.map(option => (
            <div
              className={option.name === phase ? styles.menuItemActive : styles.menuItem}
              key={option.name}
              style={option.color ? {backgroundColor: `${option.color}33`} : undefined}
            >
              <span className={styles.phaseMenuLabel}>{option.name}</span>
              {option.name === phase ? <Icons.Check className={styles.check} size={16} /> : null}
            </div>
          ))}
        </div>}
        </PortaledDropdown>
      ) : null}
    </div>
  );
}

function PortaledDropdown({
  align,
  anchorRef,
  children,
}: {
  align: 'start' | 'end';
  anchorRef: RefObject<HTMLElement | null>;
  children: (style: CSSProperties) => ReactNode;
}) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const nextStyle: CSSProperties = {
      bottom: `${window.innerHeight - rect.top + 8}px`,
      position: 'fixed',
    };
    if (align === 'start') {
      nextStyle.left = `${rect.left}px`;
    } else {
      nextStyle.right = `${window.innerWidth - rect.right}px`;
    }
    setStyle(nextStyle);
  }, [align, anchorRef]);

  if (typeof document === 'undefined') return <>{children({})}</>;
  if (!style) return <>{children({})}</>;
  return createPortal(children(style), document.body);
}
