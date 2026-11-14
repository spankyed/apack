import {Icons} from '../primitives/Icon';
import type {DatabaseBackupState} from './databaseTypes';
import './DatabaseBackupRestore.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('DatabaseBackupRestore');

export function DatabaseBackupRestore({state}: {state: DatabaseBackupState}) {
  const selectedCount = state.selectedDatabases.filter(database => database.selected).length;
  const isExport = state.activeTab === 'export';
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <button className={styles.back} type="button"><Icons.ArrowLeft size={16} />Back to Database</button>
          <div className={styles.tabs}>
            <button className={styles.tab} data-active={isExport} type="button"><Icons.HardDriveDownload size={16} />Export</button>
            <button className={styles.tab} data-active={!isExport} type="button"><Icons.HardDriveUpload size={16} />Import</button>
          </div>
          <button className={styles.action} data-tab={state.activeTab} type="button">
            {state.isProcessing ? <Icons.Loader2 className={styles.spinner} size={16} /> : isExport ? <Icons.Download size={16} /> : <Icons.Upload size={16} />}
            {state.isProcessing ? (isExport ? 'Exporting...' : 'Importing...') : (isExport ? 'Export Backup' : 'Import Backup')}
          </button>
        </div>
      </header>
      <div className={styles.scroll}>
        <div className={styles.content}>
          {isExport ? (
            <div className={styles.stack}>
              <section className={styles.card}>
                <label className={styles.label}>Backup Location</label>
                <div className={styles.inputRow}>
                  <div className={styles.inputWrap}><Icons.Folder className={styles.inputIcon} size={16} /><input className={styles.input} readOnly value={state.exportPath} /></div>
                  <button className={styles.browse} type="button"><Icons.FolderOpen size={16} />Browse</button>
                </div>
                <label className={styles.label} style={{marginTop: 16}}>Backup Name <span style={{color: 'rgb(82 82 82)'}}>(Optional)</span></label>
                <div className={styles.inputWrap}><Icons.FileText className={styles.inputIcon} size={16} /><input className={styles.input} readOnly value={state.backupName} /></div>
              </section>
              <DatabaseSelection count={selectedCount} databases={state.selectedDatabases} />
            </div>
          ) : (
            <div className={styles.stack}>
              <section className={styles.card}>
                <div className={styles.inputRow}>
                  <div className={styles.inputWrap}><Icons.FolderOpen className={styles.inputIcon} size={16} /><input className={styles.input} readOnly value={state.importPath ?? ''} placeholder="Backup directory to restore from" /></div>
                  <button className={styles.browse} type="button"><Icons.FolderOpen size={16} />Browse</button>
                </div>
              </section>
              {state.backupInfo ? <BackupInfo info={state.backupInfo} /> : null}
              <section className={styles.warning}>
                <Icons.AlertTriangle size={20} />
                <p>Importing will replace all existing data. This action cannot be undone.</p>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DatabaseSelection({count, databases}: {count: number; databases: DatabaseBackupState['selectedDatabases']}) {
  return (
    <section className={styles.card}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.title}>Databases</h3>
        <div className={styles.count}>{count} selected</div>
      </div>
      <div className={styles.grid}>
        {databases.map(database => (
          <div className={styles.dbCard} data-selected={database.selected} key={database.id}>
            <div className={styles.dbInner}>
              <span className={styles.checkbox}>{database.selected ? <Icons.Check size={16} /> : null}</span>
              <div>
                <div className={styles.dbTitle}>
                  <DatabaseIcon tone={database.tone} />
                  {database.label}
                </div>
                <div className={styles.dbDescription}>{database.description}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DatabaseIcon({tone}: {tone: DatabaseBackupState['selectedDatabases'][number]['tone']}) {
  if (tone === 'green') return <Icons.Activity className={styles.dbIconGreen} size={16} />;
  if (tone === 'amber') return <Icons.Lock className={styles.dbIconAmber} size={16} />;
  return <Icons.Database className={styles.dbIconBlue} size={16} />;
}

function BackupInfo({info}: {info: NonNullable<DatabaseBackupState['backupInfo']>}) {
  return (
    <section className={styles.card}>
      <div className={info.hasMedia ? styles.infoGridFour : styles.infoGrid}>
        <InfoCard icon={<Icons.Calendar size={16} />} label="Created" value={formatDate(info.timestamp)} />
        <InfoCard icon={<Icons.Database size={16} />} label="Databases" value={`${info.databases.length} included`} />
        <InfoCard icon={<Icons.HardDrive size={16} />} label="Size" value={formatSize(info.size)} />
        {info.hasMedia ? <InfoCard icon={<Icons.Image size={16} />} label="Media" value="Included" /> : null}
      </div>
    </section>
  );
}

function InfoCard({icon, label, value}: {icon: React.ReactNode; label: string; value: string}) {
  return (
    <div className={styles.infoCard}>
      <div className={styles.infoLabel}>
        {icon}
        <span>{label}</span>
      </div>
      <p>{value}</p>
    </div>
  );
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  if (size < 1024 * 1024 * 1024) return `${Math.round(size / (1024 * 1024))} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
