import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './ColorPicker.module.css';

const styles = makeStyles('ColorPicker');

export const defaultColorPickerColors = [
  '#6B7280',
  '#EF4444',
  '#F59E0B',
  '#10B981',
  '#3B82F6',
  '#6366F1',
  '#8B5CF6',
  '#A855F7',
  '#EC4899',
  '#14B8A6',
  '#84CC16',
  '#F97316',
  '#06B6D4',
  '#0EA5E9',
  '#78716C',
];

type ColorPickerProps = {
  allowClear?: boolean;
  colors?: string[];
  open?: boolean;
  title?: string;
  value?: string | null;
};

// Mirrors packages/renderer/src/core/components/design/ColorPicker.vue.
export function ColorPicker({
  allowClear = false,
  colors = defaultColorPickerColors,
  open = false,
  title = 'Change color',
  value = null,
}: ColorPickerProps) {
  return (
    <div className={styles.root}>
      <button
        className={styles.trigger}
        style={{backgroundColor: value || 'transparent'}}
        title={title}
        type="button"
      />
      {open ? (
        <div className={styles.palette}>
          {colors.map(color => (
            <button
              aria-label={color}
              className={styles.swatch}
              key={color}
              style={{backgroundColor: color}}
              type="button"
            />
          ))}
          {allowClear && value ? (
            <button className={styles.clear} type="button">
              <Icons.X size={12} />
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
