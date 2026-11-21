import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import './MessageAside.module.css';

const styles = makeStyles('MessageAside');

// Mirrors collapsed autoHide / asideText rendering in packages/renderer/src/plugins/threads/chat/message.vue.
export function MessageAside({asUser, text}: {asUser?: boolean; text: string}) {
  const separator = text.indexOf(' \u2014 ');
  const outcome = separator === -1 ? text : text.slice(0, separator);
  const context = separator === -1 ? '' : text.slice(separator + 3);

  return (
    <div className={cx(styles.root, asUser && styles.asUser)}>
      <button className={styles.button} type="button">
        <span>{outcome}</span>
        {context ? <span className={styles.context}>{context}</span> : null}
      </button>
    </div>
  );
}
