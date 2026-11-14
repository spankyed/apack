import {CliProviderRow, type CliProviderRowState} from './CliProviderRow';
import type {CliProviderSettings} from '../settingsTypes';
import './CliProvidersSettings.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const styles = makeStyles('CliProvidersSettings');

const defaultProviders: CliProviderRowState[] = [
  {installCmd: 'npm install -g @github/copilot', installHint: 'Install via npm', key: 'copilot', label: 'Copilot CLI', placeholder: 'Path override (auto-detected if empty)'},
  {installCmd: 'npm install -g @anthropic-ai/claude-code', installHint: 'Install via npm', key: 'claude-code', label: 'Claude Code CLI', placeholder: 'Path override (auto-detected if empty)'},
  {installCmd: 'npm install -g @openai/codex', installHint: 'Install via npm', key: 'codex', label: 'Codex CLI', placeholder: 'Path override (auto-detected if empty)'},
  {installCmd: 'brew install gh', installHint: 'Install via Homebrew', key: 'gh', label: 'GitHub CLI', placeholder: 'Path override (auto-detected if empty)'},
];

export function CliProvidersSettings({providers = defaultProviders}: {providers?: CliProviderSettings[]}) {
  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <h3 className={styles.title}>CLI Providers</h3>
        <p className={styles.description}>Leave path blank to auto-detect. Click Test to verify and resolve.</p>
      </header>
      <div className={styles.list}>
        {providers.map(provider => (
          <CliProviderRow key={provider.key} provider={provider} />
        ))}
      </div>
    </section>
  );
}
