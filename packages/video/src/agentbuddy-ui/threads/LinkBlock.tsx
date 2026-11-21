import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {LinkBlockState} from './threadTypes';
import './LinkBlock.module.css';

const styles = makeStyles('LinkBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/blocks/LinkBlock.vue.
export function LinkBlock({state}: {state: LinkBlockState}) {
  return (
    <div className={styles.root}>
      <div className={styles.inner}>
        {state.links.map(link => {
          const Icon = iconFor(link.icon);
          return (
            <button className={styles.link} key={link.label} type="button">
              <Icon size={16} />
              <span>{link.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function iconFor(icon?: LinkBlockState['links'][number]['icon']) {
  switch (icon) {
    case 'external-link': return Icons.ExternalLink;
    case 'file-text': return Icons.FileText;
    case 'message-square': return Icons.Threads;
    case 'settings': return Icons.Settings;
    default: return Icons.Link;
  }
}
