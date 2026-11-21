import {Icons} from '../../primitives/Icon';
import {CliProvidersSettings} from './CliProvidersSettings';
import type {CliProviderSettings, CustomProviderKeyState, ProviderKeyState} from '../settingsTypes';
import './SettingsCommon.module.css';
import './ProvidersSettings.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const common = makeStyles('SettingsCommon');
const styles = makeStyles('ProvidersSettings');

export function ProvidersSettings({cliProviders, customProviders = [], providers}: {cliProviders?: CliProviderSettings[]; customProviders?: CustomProviderKeyState[]; providers: ProviderKeyState[]}) {
  return (
    <div className={common.panelNarrow}>
      <header className={common.header}>
        <h2 className={common.title}>Secrets</h2>
        <p className={common.description}>Manage your API keys for various providers. Keys are stored securely in a separate database partition.</p>
      </header>
      <CliProvidersSettings providers={cliProviders} />
      <div style={{borderTop: '1px solid rgb(38 38 38)', margin: '32px 0'}} />
      <section>
        <h3 className={common.sectionHeader}>Standard Providers</h3>
        <div className={styles.grid}>
          {providers.map(provider => (
            <ProviderRow key={provider.key} provider={provider} />
          ))}
        </div>
      </section>
      <div style={{borderTop: '1px solid rgb(38 38 38)', margin: '32px 0'}} />
      <section>
        <h3 className={common.sectionHeader}>Custom Providers</h3>
        {customProviders.length > 0 ? (
          <div className={styles.grid}>
            {customProviders.map(provider => (
              <CustomProviderRow key={provider.id} provider={provider} />
            ))}
          </div>
        ) : null}
        <button className={styles.addCustomButton} type="button">
          <Icons.Plus size={14} />
          Add Custom Provider
        </button>
      </section>
    </div>
  );
}

function ProviderRow({provider}: {provider: ProviderKeyState}) {
  const editing = Boolean(provider.editing);
  return (
    <>
      <div>
        <button className={styles.providerLabel} title={`Open ${provider.label} API keys page`} type="button">
          {provider.label}<Icons.ExternalLink size={12} />
        </button>
        {provider.priority ? <span className={styles.priority} data-priority={provider.priority}><span className={styles.dot} />{provider.priority}</span> : null}
        <div className={styles.description}>{provider.description}</div>
      </div>
      <div>
        {editing ? (
          <div className={styles.inputWrap}>
            <input className={styles.providerInput} readOnly value={provider.value ?? ''} placeholder={provider.placeholder ?? `Enter ${provider.label} API key`} />
            <button className={styles.eyeButton} type="button"><Icons.Eye size={14} /></button>
          </div>
        ) : provider.hasKey ? (
          <span className={styles.masked}>••••••••</span>
        ) : (
          <div className={styles.inputWrap}>
            <input className={styles.providerInput} readOnly value="" placeholder={provider.placeholder ?? `Enter ${provider.label} API key`} />
            <button className={styles.eyeButton} type="button"><Icons.Eye size={14} /></button>
          </div>
        )}
      </div>
      <div className={styles.actions}>
        {editing ? (
          <button className={styles.iconButton} data-pressed={provider.pressedAction === 'save' || undefined} type="button"><Icons.Check size={14} /></button>
        ) : provider.hasKey ? (
          <>
            <button className={styles.iconButton} data-pressed={provider.pressedAction === 'edit' || undefined} type="button"><Icons.Edit2 size={14} /></button>
            <button className={styles.iconButton} data-danger data-pressed={provider.pressedAction === 'delete' || undefined} type="button"><Icons.Trash2 size={14} /></button>
          </>
        ) : null}
      </div>
    </>
  );
}

function CustomProviderRow({provider}: {provider: CustomProviderKeyState}) {
  return (
    <>
      <div>
        <div className={styles.providerLabel}>{provider.name}</div>
        <div className={styles.description}>Custom Provider</div>
      </div>
      <div>{provider.hasKey ? <span className={styles.masked}>••••••••</span> : <input className={styles.providerInput} readOnly value="" placeholder="Enter API key" />}</div>
      <div className={styles.actions}>
        <button className={styles.iconButton} type="button"><Icons.Edit2 size={14} /></button>
        <button className={styles.iconButton} data-danger type="button"><Icons.Trash2 size={14} /></button>
      </div>
    </>
  );
}
