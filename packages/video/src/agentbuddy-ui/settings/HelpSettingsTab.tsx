import {Icons} from '../primitives/Icon';
import type {SettingsSurfaceState} from './settingsTypes';
import './HelpSettingsTab.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('HelpSettingsTab');

export function HelpSettingsTab({state}: {state: SettingsSurfaceState}) {
  return (
    <div className={styles.root}>
      <div className={styles.scroll}>
        <div className={styles.inner}>
          <h2 className={styles.title}>Frequently Asked Questions</h2>
          <div className={styles.list}>
            {state.faqs.map(item => (
              <article className={styles.item} key={item.id}>
                <button className={styles.question} data-expanded={item.expanded} type="button">
                  <span>{item.question}</span>
                  <Icons.ChevronDown size={16} />
                </button>
                {item.expanded ? <div className={styles.answer}>{item.answer}</div> : null}
              </article>
            ))}
          </div>
        </div>
      </div>
      <footer className={styles.footer}>
        <p><span className={styles.link}>Join our Discord community</span></p>
        <p>Developed in memory of <span className={styles.link}>Kathie Lovett Ulrich</span></p>
      </footer>
    </div>
  );
}
