import {Icons} from '../../primitives/Icon';
import type {SettingsSurfaceState} from '../settingsTypes';
import './SettingsCommon.module.css';
import './PersonalSettings.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const styles = makeStyles('SettingsCommon');
const personal = makeStyles('PersonalSettings');

export function PersonalSettings({user}: {user: SettingsSurfaceState['user']}) {
  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>Personal Information</h2>
        <p className={styles.description}>Manage your personal details and contact information. This information is only stored locally on your device, to be used in AI workflows.</p>
      </header>
      <section className={styles.card}>
        <div className={`${styles.sectionHeader} ${personal.cardHeader}`}><Icons.User size={16} />Personal Details</div>
        <div className={styles.grid2}>
          <label><span className={styles.label}>Full Name</span><input className={styles.input} placeholder="John Doe" readOnly value={user.name} /><div className={styles.hint}>How you'd like to be addressed</div></label>
          <label><span className={styles.label}>Phone Number</span><input className={styles.input} maxLength={14} placeholder="(555) 123-4567" readOnly value={user.phoneNumber} /><div className={styles.hint}>For important notifications</div></label>
        </div>
      </section>
      <section className={styles.card}>
        <div className={`${styles.sectionHeader} ${personal.cardHeader}`}><Icons.MapPin size={16} />Address Information</div>
        <div className={personal.addressStack}>
          <label className={personal.fieldLg}><span className={styles.label}>Street Address</span><input className={styles.input} readOnly value={user.address.street} placeholder="123 Main Street" /></label>
          <label className={personal.fieldSm}>
            <span className={styles.label}>Apartment / Suite <span className={personal.optional}>(optional)</span></span>
            <input className={styles.input} readOnly value={user.address.street2 ?? ''} placeholder="Apt 4B, Suite 200, etc." />
          </label>
          <div className={personal.cityRow}>
            <label><span className={styles.label}>City</span><input className={styles.input} readOnly value={user.address.city} placeholder="New York" /></label>
            <label><span className={styles.label}>State</span><select className={personal.select} onChange={() => undefined} value={user.address.state}><option value="">{user.address.state || 'Select'}</option><option value={user.address.state}>{user.address.state}</option></select></label>
            <label><span className={styles.label}>ZIP Code</span><input className={styles.input} maxLength={10} readOnly value={user.address.postalCode} placeholder="12345" /></label>
          </div>
          <label className={personal.fieldXs}><span className={styles.label}>Country</span><select className={personal.select} onChange={() => undefined} value={user.address.country}><option value={user.address.country}>{countryLabel(user.address.country)}</option></select></label>
        </div>
      </section>
    </div>
  );
}

function countryLabel(country: string) {
  if (country === 'US') return 'United States';
  if (country === 'CA') return 'Canada';
  if (country === 'MX') return 'Mexico';
  if (country === 'GB') return 'United Kingdom';
  if (country === 'AU') return 'Australia';
  if (country === 'DE') return 'Germany';
  if (country === 'FR') return 'France';
  if (country === 'JP') return 'Japan';
  if (country === 'CN') return 'China';
  if (country === 'IN') return 'India';
  if (country === 'BR') return 'Brazil';
  return country || 'Other';
}
