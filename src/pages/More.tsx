import { Link } from 'react-router-dom';
import { Icon } from '../components/ui';

const ITEMS: Array<[string, string, string, string]> = [
  ['/transactions', 'Transactions', 'list', 'Search and filter everything'],
  ['/recurring', 'Bills & income', 'repeat', 'Subscriptions, salary, monthly transfers'],
  ['/yearly', 'Yearly expenses', 'envelope', 'Once-a-year costs and their fund'],
  ['/forecast', 'Forecast', 'forecast', 'Projected balances and scenarios'],
  ['/reports', 'Reports', 'report', 'Charts and Excel downloads'],
  ['/categories', 'Categories', 'list', 'Add, edit and limit categories to accounts'],
  ['/import', 'Import from Excel', 'import', 'Bring in a budget workbook'],
  ['/settings', 'Settings & sync', 'settings', 'OneDrive, passphrase, categories']
];

export default function More() {
  return (
    <div>
      <div className="page-head"><h1>More</h1></div>
      <div className="list">
        {ITEMS.map(([to, label, icon, meta]) => (
          <Link key={to} to={to} className="list-row click" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Icon name={icon} />
            <div className="grow">
              <div className="title">{label}</div>
              <div className="meta">{meta}</div>
            </div>
            <Icon name="chev" size={18} />
          </Link>
        ))}
      </div>
    </div>
  );
}
