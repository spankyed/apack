import {Icons} from '../../primitives/Icon';
import './CodeDirectorySelect.module.css';
import {makeStyles} from '../../primitives/makeStyles';

const styles = makeStyles('CodeDirectorySelect');

type CodeDirectorySelectProps = {
  disabled?: boolean;
  value?: string | null;
};

export function CodeDirectorySelect({disabled = false, value}: CodeDirectorySelectProps) {
  const selectedLabel = value == null ? 'Use last opened directory' : getFolderName(value);

  return (
    <div className={styles.root}>
      <button className={styles.trigger} disabled={disabled} type="button">
        <span className={styles.selectedLabel}>{selectedLabel}</span>
        <Icons.ChevronDown className={styles.chevron} size={16} />
      </button>
    </div>
  );
}

function getFolderName(path: string) {
  const segments = path.split('/').filter(Boolean);
  return segments.at(-1) || path;
}
