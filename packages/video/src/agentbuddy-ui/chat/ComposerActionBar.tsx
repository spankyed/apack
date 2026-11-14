import type {CSSProperties, ReactNode, RefObject} from 'react';
import {useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Icons} from '../primitives/Icon';
import {ComposerIconButton} from './ComposerIconButton';
import {ModePhaseSelector} from './ModePhaseSelector';
import {QuickPromptsPopup} from './QuickPromptsPopup';
import {SendButton} from './SendButton';
import type {ChatModeOption, QuickPromptState} from './chatTypes';
import './ChatComposer.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('ChatComposer');

type ComposerActionBarProps = {
  disabled?: boolean;
  forcedMode?: string;
  mode: string;
  modeOptions?: ChatModeOption[];
  openSelector?: 'mode' | 'more-actions' | 'phase';
  phase?: string;
  busy?: boolean;
  referenceButtonPressed?: boolean;
  quickPrompts?: QuickPromptState[];
  quickPromptsButtonPressed?: boolean;
  quickPromptsEditing?: boolean;
  quickPromptsEditingId?: string;
  quickPromptsEditingText?: string;
  quickPromptsNewText?: string;
  quickPromptsOpen?: boolean;
  quickPromptsSelectedIndex?: number;
  recording?: boolean;
  sendDisabled?: boolean;
  sendPressed?: boolean;
  speechSupported?: boolean;
};

// Mirrors the button row in packages/renderer/src/plugins/threads/chat/input.vue.
export function ComposerActionBar({busy, disabled, forcedMode, mode, modeOptions, openSelector, phase, quickPrompts, quickPromptsButtonPressed, quickPromptsEditing, quickPromptsEditingId, quickPromptsEditingText, quickPromptsNewText, quickPromptsOpen, quickPromptsSelectedIndex, recording, referenceButtonPressed, sendDisabled, sendPressed, speechSupported = true}: ComposerActionBarProps) {
  const moreActionsRef = useRef<HTMLSpanElement>(null);
  const leftMenuItems = [
    {className: referenceButtonPressed ? styles.moreActionsMenuItemActive : undefined, icon: Icons.Hash, label: 'Add reference'},
    {icon: Icons.Paperclip, label: 'Attach file'},
    {className: quickPromptsButtonPressed ? styles.moreActionsMenuItemActive : undefined, icon: Icons.Sparkle, label: 'Quick message'},
    ...(speechSupported ? [{
      className: recording ? styles.moreActionsMenuItemRecording : undefined,
      icon: recording ? Icons.MicOff : Icons.Mic,
      label: recording ? 'Stop listening' : 'Voice input',
    }] : []),
  ];
  return (
    <div className={styles.actionBar}>
      <div className={styles.leftActions}>
        <span className={styles.moreActionsAnchor} ref={moreActionsRef}>
          <ComposerIconButton disabled={disabled} icon={Icons.EllipsisVertical} label="More actions" />
          {openSelector === 'more-actions' ? (
            <MoreActionsMenu anchorRef={moreActionsRef}>
              {leftMenuItems.map(item => (
                <div className={item.className ? `${styles.moreActionsMenuItem} ${item.className}` : styles.moreActionsMenuItem} key={item.label}>
                  <item.icon size={16} />
                  <span>{item.label}</span>
                </div>
              ))}
            </MoreActionsMenu>
          ) : null}
        </span>
        <span className={styles.expandedActionButtons}>
          <ComposerIconButton disabled={disabled} icon={Icons.Hash} label="Add reference" pressed={referenceButtonPressed} />
          <ComposerIconButton disabled={disabled} icon={Icons.Paperclip} label="Attach file" />
        </span>
        <span className={styles.quickPromptsAnchor}>
          <span className={styles.expandedActionButtons}>
            <ComposerIconButton disabled={disabled} icon={Icons.Sparkle} label="Quick message" pressed={quickPromptsButtonPressed} />
          </span>
          {quickPromptsOpen ? (
            <QuickPromptsPopup
              editing={quickPromptsEditing}
              editingId={quickPromptsEditingId}
              editingText={quickPromptsEditingText}
              newPromptText={quickPromptsNewText}
              prompts={quickPrompts ?? []}
              selectedIndex={quickPromptsSelectedIndex}
            />
          ) : null}
        </span>
        {speechSupported ? (
          <span className={styles.expandedActionButtons}>
            <ComposerIconButton className={recording ? styles.recordingButton : undefined} disabled={disabled} icon={recording ? Icons.MicOff : Icons.Mic} label={recording ? 'Stop listening' : 'Voice input'} />
          </span>
        ) : null}
        <div className={styles.modeSelectorSlot} data-open={openSelector || undefined}>
          <ModePhaseSelector disabled={disabled} forcedMode={forcedMode} mode={mode} modeOptions={modeOptions} openSelector={openSelector === 'more-actions' ? undefined : openSelector} phase={phase} />
        </div>
      </div>
      <div className={styles.rightActions}>
        {busy ? (
          <button className={styles.pauseButton} type="button" title="Pause agent work">
            <span className={styles.responsiveButtonLabel}>Pause</span>
            <PauseGlyph />
          </button>
        ) : null}
        <SendButton disabled={sendDisabled ?? disabled} pressed={sendPressed} />
      </div>
    </div>
  );
}

function MoreActionsMenu({anchorRef, children}: {anchorRef: RefObject<HTMLElement | null>; children: ReactNode}) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setStyle({
      bottom: `${window.innerHeight - rect.top + 8}px`,
      left: `${rect.left}px`,
      position: 'fixed',
    });
  }, [anchorRef]);

  const menu = <div className={styles.moreActionsMenu} style={style ?? undefined}>{children}</div>;
  if (typeof document === 'undefined' || !style) return menu;
  return createPortal(menu, document.body);
}

function PauseGlyph() {
  return (
    <svg aria-hidden="true" className={styles.pauseIcon} fill="none" height="22" viewBox="0 0 24 24" width="22">
      <rect fill="currentColor" height="12" rx="1" width="4" x="6" y="6" />
      <rect fill="currentColor" height="12" rx="1" width="4" x="14" y="6" />
    </svg>
  );
}
