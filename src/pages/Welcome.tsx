import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/ui';
import { loadDemo, startEmpty } from '../lib/seed';

export default function Welcome() {
  const nav = useNavigate();
  return (
    <div className="main welcome">
      <div className="brand" style={{ color: 'var(--ink)', padding: 0 }}>
        <img src="icon.svg" alt="" /> Household Finance
      </div>
      <h1 style={{ marginTop: 'var(--s6)', fontSize: 40 }}>Where should we start?</h1>
      <p className="muted" style={{ marginTop: 8, maxWidth: '60ch' }}>
        Accounts, budgets and forecasts for the two of you. Data stays on this device until you turn on OneDrive sync.
      </p>
      <div className="choices">
        <button className="choice" onClick={() => nav('/import')}>
          <Icon name="import" size={24} />
          <div>
            <h3>Import my Excel budget</h3>
            <p>Account sheets, monthly budgets, yearly expenses, subscriptions and BNR rates come across with a preview before anything is saved.</p>
          </div>
        </button>
        <button className="choice" onClick={() => nav('/settings')}>
          <Icon name="cloud" size={24} />
          <div>
            <h3>Join our household on OneDrive</h3>
            <p>Your partner already set it up and shared the folder with you. Sign in and enter the household passphrase.</p>
          </div>
        </button>
        <button className="choice" onClick={() => startEmpty()}>
          <Icon name="accounts" size={24} />
          <div>
            <h3>Start fresh</h3>
            <p>Your usual accounts and categories (income, planned costs, reservations, unplanned costs), with zero balances.</p>
          </div>
        </button>
        <button className="choice" onClick={() => loadDemo()}>
          <Icon name="budget" size={24} />
          <div>
            <h3>Look around with sample data</h3>
            <p>Six months of made-up transactions and budgets. Erase it later under Settings → Data.</p>
          </div>
        </button>
      </div>
    </div>
  );
}
