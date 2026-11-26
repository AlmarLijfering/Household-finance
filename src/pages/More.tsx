import { Link } from 'react-router-dom';
import { Icon } from '../components/ui';
import { ARCHIVE_YEAR } from '../lib/db';
import { useMenu } from '../lib/menu';
import { HouseholdUpdated } from '../App';



export default function More() {
  const menu = useMenu();
  // everything not already in the phone bar (the first three items), Settings always last
  const shown = menu.visible.filter((e) => !ARCHIVE_YEAR || (e.id !== 'import' && e.id !== 'settings'));
  const inBar = menu.bar.map((e) => e.id);
  const rest = shown.filter((e) => !inBar.includes(e.id));
  return (
    <div>
      <div className="page-head">
        <h1>More</h1>
        <HouseholdUpdated className="hh-updated light" />
      </div>
      <div className="list">
        {rest.map(({ to, name: label, icon, desc: meta }) => (
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
