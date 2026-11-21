import {Icons} from '../primitives/Icon';
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
  const selected = selectedTags.map(tagName => {
    const tag = availableTags.find(option => option.name === tagName);
    return {name: tagName, color: tag?.color};
  });

  return (
    <div className={styles.root}>
      <div className={styles.trigger} data-open="false">
        <div className={styles.tags}>
          {selected.map(tag => {
            const color = tag.color ?? '#A855F7';
            return (
              <span
                className={styles.selectedTag}
                key={tag.name}
                style={{
                  backgroundColor: `${color}20`,
                  borderColor: `${color}33`,
                  color,
                }}
              >
                {tag.name}
                <Icons.X size={14} />
              </span>
            );
          })}
          <span className={styles.input}>Search tags...</span>
        </div>
        <Icons.ChevronDown className={styles.chevron} size={16} />
      </div>
    </div>
  );
}
