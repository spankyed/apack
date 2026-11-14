import {Icons} from '../../agentbuddy-ui/primitives/Icon';
import {makeStyles} from '../../agentbuddy-ui/primitives/makeStyles';
import './ExternalBrowserWindow.module.css';

const styles = makeStyles('ExternalBrowserWindow');

// Film-only prop for a launched local app. This intentionally does not live in
// agentbuddy-ui because it is not an AgentBuddy renderer component.
export function ExternalBrowserWindow() {
  return (
    <div className={styles.window}>
      <div className={styles.titlebar}>
        <div className={styles.trafficLights}>
          <span />
          <span />
          <span />
        </div>
        <div className={styles.address}>
          <Icons.ExternalLink size={13} />
          <span>localhost:5173</span>
        </div>
      </div>
      <main className={styles.page}>
        <section className={styles.storefront}>
          <p className={styles.eyebrow}>Supafan checkout preview</p>
          <h1>Ship a digital product in minutes.</h1>
          <div className={styles.checkoutCard}>
            <div>
              <span className={styles.productLabel}>Creator Kit</span>
              <strong>$49.00</strong>
            </div>
            <div className={styles.checkoutRows}>
              <span>Stripe payment</span>
              <span>Receipt email</span>
              <span>Discount code</span>
            </div>
            <button>Complete checkout</button>
          </div>
        </section>
      </main>
    </div>
  );
}
