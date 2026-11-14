import {makeStyles} from '../primitives/makeStyles';
import './LibraryTagInput.module.css';

const styles = makeStyles('LibraryTagInput');

export function LibraryTagInput({
  availableTags,
  selectedTags,
}: {
  availableTags: Array<{color?: string; name: string}>;
  selectedTags: string[];
}) {
  return (
    <div className={styles.root}>
      {availableTags.map(tag => {
        const selected = selectedTags.includes(tag.name);
        return (
          <span className={styles.tag} data-selected={selected ? 'true' : undefined} key={tag.name}>
            <span className={styles.dot} style={{backgroundColor: tag.color ?? '#3b82f6'}} />
            {tag.name}
          </span>
        );
      })}
    </div>
  );
}
