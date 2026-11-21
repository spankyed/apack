import {Icons} from '../../primitives/Icon';
import type {ReactNode} from 'react';
import {CollapsiblePluginSection} from './CollapsiblePluginSection';
import type {SettingsSurfaceState} from '../settingsTypes';
import './FlowsPluginSettings.module.css';
import {makeStyles} from '../../primitives/makeStyles';

const styles = makeStyles('FlowsPluginSettings');

type FlowsSettings = NonNullable<NonNullable<SettingsSurfaceState['selectedPluginSettings']>['flows']>;

const defaultFlowsSettings: FlowsSettings = {
  enableFlowPreview: true,
  flows: [],
};

export function FlowsPluginSettings({settings}: {settings?: FlowsSettings}) {
  const value = settings ?? defaultFlowsSettings;
  const exportDirectory = value.exportDirectory ?? '';
  const importStatus = value.importStatus ?? 'idle';
  const exportStatus = value.exportStatus ?? 'idle';
  const currentRootFlow = value.rootFlowId
    ? value.flows.find(flow => flow.id === value.rootFlowId)
    : null;

  return (
    <div className={styles.root}>
      <CollapsiblePluginSection label="Root Flow">
        <p className={styles.copy}>Select which flow should be the root flow for dialog execution</p>
        <div className={styles.stack}>
          <div className={styles.row}>
            <span className={styles.label}>Root Flow:</span>
            <select className={styles.select} data-onboarding-id="settings-root-flow" defaultValue={value.rootFlowId ?? ''}>
              <option value="">None</option>
              {value.flows.map(flow => (
                <option key={flow.id} value={flow.id}>{flow.label || flow.id}</option>
              ))}
            </select>
          </div>
          {value.needsRestart && currentRootFlow ? (
            <div className={styles.restartNotice}>
              <Icons.AlertTriangle className={styles.restartIcon} size={20} />
              <div className={styles.restartBody}>
                <div className={styles.restartTitle}>Root flow changed - Brain restart required</div>
                <p className={styles.restartCopy}>The root flow has been updated. Please restart the application from Brain settings to apply the changes.</p>
                <button className={styles.restartButton} type="button">
                  <Icons.Brain size={16} />
                  Go to Brain Settings
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label="Flow Preview">
        <p className={styles.copy}>Configure how flows are opened when clicking from the list</p>
        <div className={styles.stack}>
          <label className={styles.checkboxRow}>
            <input className={styles.checkbox} readOnly checked={value.enableFlowPreview} type="checkbox" />
            <span>
              <span className={styles.checkboxTitle}>Enable flow preview on single click</span>
              <span className={styles.checkboxCopy}>
                When enabled, single-click previews a flow with overlay. Double-click or click overlay to edit. When disabled, single-click opens the editor directly.
              </span>
            </span>
          </label>
        </div>
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label="Import Flows">
        <p className={styles.copy}>Import flows from an exported DSL JSON file</p>
        <div className={styles.stack}>
          <button className={styles.secondaryButton} disabled={importStatus === 'importing'} type="button">
            <Icons.Upload size={16} />
            {importStatus === 'importing' ? 'Importing...' : 'Select DSL File...'}
          </button>
          {importStatus === 'success' ? (
            <StatusCard tone="success" title={`Successfully imported ${(value.importedFlowNames ?? []).length} flow${(value.importedFlowNames ?? []).length !== 1 ? 's' : ''}`}>
              {(value.importedFlowNames ?? []).length > 0 ? (
                <ul className={styles.statusList}>
                  {(value.importedFlowNames ?? []).map(name => <li key={name}>{name}</li>)}
                </ul>
              ) : null}
            </StatusCard>
          ) : null}
          {importStatus === 'error' ? (
            <StatusCard tone="error" title="Import failed">
              <ul className={styles.statusList}>
                {(value.importErrors ?? []).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
              </ul>
            </StatusCard>
          ) : null}
        </div>
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label="Export Flows" defaultOpen={false}>
        <p className={styles.copy}>Export all flows to a DSL JSON file</p>
        <div className={styles.stack}>
          <div className={styles.directoryRow}>
            <input className={styles.directoryInput} readOnly type="text" value={exportDirectory} placeholder="Select output directory..." />
            <button className={styles.secondaryButton} type="button">
              <Icons.FolderOpen size={16} />
              Browse
            </button>
          </div>
          <button className={styles.secondaryButton} disabled={exportStatus === 'exporting' || !exportDirectory} type="button">
            <Icons.Download size={16} />
            {exportStatus === 'exporting' ? 'Exporting...' : 'Export'}
          </button>
          {exportStatus === 'success' ? (
            <StatusCard tone="success" title={`Successfully exported ${value.exportedFlowCount ?? 0} flow${(value.exportedFlowCount ?? 0) !== 1 ? 's' : ''}`}>
              {value.exportedFilePath ? <p className={styles.statusCopy}>{value.exportedFilePath}</p> : null}
            </StatusCard>
          ) : null}
          {exportStatus === 'error' ? (
            <StatusCard tone="error" title="Export failed">
              <ul className={styles.statusList}>
                {(value.exportErrors ?? []).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
              </ul>
            </StatusCard>
          ) : null}
        </div>
      </CollapsiblePluginSection>
    </div>
  );
}

function StatusCard({children, title, tone}: {children?: ReactNode; title: string; tone: 'error' | 'success'}) {
  const Icon = tone === 'success' ? Icons.CircleCheck : Icons.CircleX;

  return (
    <div className={styles.statusCard} data-tone={tone}>
      <Icon className={styles.statusIcon} size={20} />
      <div className={styles.statusBody}>
        <div className={styles.statusTitle}>{title}</div>
        {children}
      </div>
    </div>
  );
}
