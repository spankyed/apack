import type {ComponentType} from 'react';
import {cx} from '../primitives/classNames';
import './ChatComposer.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('ChatComposer');

type ComposerIconButtonProps = {
  className?: string;
  disabled?: boolean;
  icon: ComponentType<{size?: number; className?: string}>;
  label: string;
  pressed?: boolean;
};

export function ComposerIconButton({className, disabled, icon: Icon, label, pressed}: ComposerIconButtonProps) {
  return (
    <button aria-label={label} className={cx(styles.iconButton, className)} data-pressed={pressed || undefined} disabled={disabled} title={label} type="button">
      <Icon size={20} />
    </button>
  );
}
