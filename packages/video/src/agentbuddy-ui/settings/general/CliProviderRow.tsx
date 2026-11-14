import {Icons} from '../../primitives/Icon';
import './CliProviderRow.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const styles = makeStyles('CliProviderRow');

export type CliProviderRowState = {
  installCmd: string;
  installHint: string;
  key: string;
  label: string;
  placeholder: string;
  status?: 'success' | 'error' | 'testing';
  value?: string;
};

export function CliProviderRow({provider}: {provider: CliProviderRowState}) {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.labelWrap}>
          <span className={styles.label}>{provider.label}</span>
          {provider.status === 'success' ? <Icons.CircleCheck className={styles.successIcon} size={14} /> : null}
          {provider.status === 'error' ? <Icons.X className={styles.errorIcon} size={14} /> : null}
        </div>
        <button className={styles.testButton} data-status={provider.status} type="button">
          {provider.status === 'testing' ? <Icons.Loader2 className={styles.spinner} size={14} /> : 'Test'}
        </button>
      </div>

      <input className={styles.input} readOnly placeholder={provider.placeholder} value={provider.value ?? ''} />

      <div className={styles.helper}>
        <span>{provider.installHint}</span>
        <code className={styles.command}>{provider.installCmd}</code>
      </div>
    </div>
  );
}
