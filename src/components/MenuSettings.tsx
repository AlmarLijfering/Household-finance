import { useState } from 'react';
import { DEFAULT_MENU, DIVIDER, MENU_ITEMS, loadMenu, saveMenu, type MenuConfig } from '../lib/menu';
import { Icon, useToast } from './ui';
import { cx } from '../lib/util';

/** Menu setup: names, order, what is shown and the start page. Saved on this device as you go. */
export function MenuSettings() {
  const toast = useToast();
  const [c, setC] = useState<MenuConfig>(loadMenu);
  const update = (next: MenuConfig) => {
    setC(next);
    saveMenu(next);
  };
  const byId = new Map(MENU_ITEMS.map((i) => [i.id, i]));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= c.order.length) return;
    const order = [...c.order];
    [order[i], order[j]] = [order[j], order[i]];
    update({ ...c, order });
  };
  const shown = (id: string) => !c.hidden.includes(id);
  const firstThree = c.order.filter((id) => id !== DIVIDER && id !== 'settings' && shown(id)).slice(0, 3);

  return (
    <section className="panel">
      <div className="row wrap" style={{ alignItems: 'flex-start', marginBottom: 12 }}>
        <div className="grow">
          <h3 style={{ margin: 0 }}>Menu</h3>
          <p className="small muted" style={{ margin: '4px 0 0', maxWidth: '72ch' }}>
            Rename, reorder or hide menu items, and pick the page the app opens on. Changes apply right away and are kept on this device, so your phone and laptop can each have their own menu. On a phone the first three items go in the bar at the bottom; the rest is under More.
          </p>
        </div>
        <button
          className="btn sm"
          onClick={() => {
            update({ ...DEFAULT_MENU, labels: {}, hidden: [...DEFAULT_MENU.hidden], order: [...DEFAULT_MENU.order] });
            saveMenu(null);
            toast('Menu back to the standard setup');
          }}
        >
          Reset to standard
        </button>
      </div>

      <div className="menu-setup" role="list">
        <div className="menu-row head" aria-hidden="true">
          <span>Order</span>
          <span />
          <span>Name in the menu</span>
          <span className="c">Show</span>
          <span className="c">Opens on</span>
        </div>
        {c.order.map((id, i) => {
          if (id === DIVIDER)
            return (
              <div key={id} className="menu-row divider" role="listitem">
                <span className="menu-move">
                  <button className="icon-btn" aria-label="Move the line up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={16} /></button>
                  <button className="icon-btn" aria-label="Move the line down" disabled={i === c.order.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={16} /></button>
                </span>
                <span />
                <span className="menu-line">Line between the main and the lower part of the menu</span>
                <span />
                <span />
              </div>
            );
          const def = byId.get(id)!;
          const on = shown(id);
          return (
            <div key={id} className={cx('menu-row', !on && 'off')} role="listitem">
              <span className="menu-move">
                <button className="icon-btn" aria-label={`Move ${def.label} up`} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={16} /></button>
                <button className="icon-btn" aria-label={`Move ${def.label} down`} disabled={i === c.order.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={16} /></button>
              </span>
              <Icon name={def.icon} />
              <span className="menu-name">
                <input
                  className="input"
                  value={c.labels[id] ?? ''}
                  placeholder={def.label}
                  aria-label={`Name for ${def.label}`}
                  maxLength={28}
                  onChange={(e) => update({ ...c, labels: { ...c.labels, [id]: e.target.value } })}
                />
                {firstThree.includes(id) ? <span className="badge" title="Shown in the bar at the bottom on a phone">phone bar</span> : null}
              </span>
              <span className="c">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={def.fixed || c.start === id}
                  title={def.fixed ? 'Settings always stays in the menu' : c.start === id ? 'The start page cannot be hidden' : undefined}
                  aria-label={`Show ${def.label}`}
                  onChange={() => update({ ...c, hidden: on ? [...c.hidden, id] : c.hidden.filter((x) => x !== id) })}
                />
              </span>
              <span className="c">
                <input type="radio" name="menu-start" checked={c.start === id} disabled={!on} aria-label={`Open the app on ${def.label}`} onChange={() => update({ ...c, start: id })} />
              </span>
            </div>
          );
        })}
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>Leave a name empty to use the standard one. Settings always stays in the menu, so you can come back here.</p>
    </section>
  );
}
