import type {ComponentType} from 'react';
import {cx} from '../primitives/classNames';
import './Toolbar.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('Toolbar');

type ToolbarButtonProps = {
  active?: boolean;
  icon: ComponentType<{size?: number; className?: string}>;
  id: string;
  label: string;
};

export function ToolbarButton({active, icon: Icon, id, label}: ToolbarButtonProps) {
  return (
    <button className={cx(styles.button, active && styles.active)} title={label} data-onboarding-id={`plugin-${id}`} type="button">
      <Icon size={24} />
    </button>
  );
}
