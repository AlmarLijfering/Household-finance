import { useState } from 'react';
import { DEFAULT_MENU, MENU_ICONS, MENU_ITEMS, PHONE_BAR_MAX, loadMenu, newSectionId, resolveMenu, saveMenu, type MenuConfig, type MenuRow } from '../lib/menu';
import { Icon, useToast } from './ui';
import { cx } from '../lib/util';

const AREAS: Array<[string, string]> = [
  ['daily', 'Daily use'],
  ['setup', 'Budget setup & sharing'],
  ['data', 'Your data'],
  ['device', 'This device']
];

/**
 * Menu setup: which pages are in the side menu, in what order and sections, with what names
 * and icons, what goes in the phone bar and where the app opens. Saved on this device as you go.
 */
export function MenuSettings() {
  const toast = useToast();
  const [c, setC] = useState<MenuConfig>(loadMenu);
  const [iconFor, setIconFor] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const update = (next: MenuConfig) => {
    setC(next);
    saveMenu(next);
  };
  const byId = new Map(MENU_ITEMS.map((i) => [i.id, i]));
  const resolved = resolveMenu(c);
  const inMenu = new Set(c.rows.filter((r) => r.kind === 'page').map((r) => r.id));
  const barIds = resolved.bar.map((e) => e.id);
  const pages = resolved.visible;

  const setRows = (rows: MenuRow[], extra: Partial<MenuConfig> = {}) => update({ ...c, ...extra, rows });
  const patchRow = (i: number, p: Partial<MenuRow>) => setRows(c.rows.map((r, j) => (j === i ? ({ ...r, ...p } as MenuRow) : r)));
  const moveTo = (from: number, to: number) => {
    if (from === to || to < 0 || to >= c.rows.length) return;
    const rows = [...c.rows];
    const [r] = rows.splice(from, 1);
    rows.splice(to, 0, r);
    setRows(rows);
  };
  const remove = (i: number) => {
    const r = c.rows[i];
    const rows = c.rows.filter((_, j) => j !== i);
    if (r.kind === 'page') {
      const start = c.start === r.id ? (rows.find((x) => x.kind === 'page')?.id ?? 'settings') : c.start;
      setRows(rows, { start, bar: c.bar ? c.bar.filter((x) => x !== r.id) : null });
      toast({ text: `${byId.get(r.id)?.label} removed from the menu`, action: { label: 'Undo', run: () => update(c) } });
    } else setRows(rows);
  };
  const add = (id: string) => {
    // new pages go above Settings when Settings is the last item, otherwise at the end
    const rows = [...c.rows];
    const last = rows[rows.length - 1];
    rows.splice(last?.kind === 'page' && last.id === 'settings' ? rows.length - 1 : rows.length, 0, { kind: 'page', id });
    setRows(rows);
  };
  const toggleBar = (id: string) => {
    const cur = [...barIds];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, PHONE_BAR_MAX);
    // keep the menu order in the bar
    update({ ...c, bar: pages.map((e) => e.id).filter((x) => next.includes(x)) });
  };

  return (
    <section className="panel menu-editor">
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
        <div className="grow">
          <h3 style={{ margin: 0 }}>Menu</h3>
          <p className="small muted" style={{ margin: '4px 0 0', maxWidth: '72ch' }}>
            Put any page in the side menu, in your own order and sections. Changes apply right away and are kept on this device, so your phone and laptop can each have their own menu.
          </p>
        </div>
        <label className="menu-start">
          <span className="small muted">App opens on</span>
          <select className="input" value={c.start} onChange={(e) => update({ ...c, start: e.target.value })}>
            {pages.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </label>
        <button
          className="btn sm"
          style={{ alignSelf: 'flex-end' }}
          onClick={() => {
            const before = c;
            update(structuredClone(DEFAULT_MENU));
            saveMenu(null);
            toast({ text: 'Menu back to the standard setup', action: { label: 'Undo', run: () => update(before) } });
          }}
        >
          Reset to standard
        </button>
      </div>

      <div className="menu-cols">
        <div>
          <div className="menu-col-head">
            <b>Your menu</b>
            <span className="small muted">Drag or use the arrows · phone bar: {barIds.length}/{PHONE_BAR_MAX}{c.bar ? '' : ' (first three)'}</span>
          </div>
          <div className="menu-list" role="list">
            {c.rows.map((r, i) => {
              const key = r.kind === 'page' ? r.id : '§' + r.id;
              const common = {
                role: 'listitem',
                draggable: true,
                onDragStart: (e: React.DragEvent) => {
                  setDrag(i);
                  e.dataTransfer.effectAllowed = 'move';
                },
                onDragOver: (e: React.DragEvent) => {
                  e.preventDefault();
                  if (over !== i) setOver(i);
                },
                onDrop: (e: React.DragEvent) => {
                  e.preventDefault();
                  if (drag != null) moveTo(drag, i);
                  setDrag(null);
                  setOver(null);
                },
                onDragEnd: () => {
                  setDrag(null);
                  setOver(null);
                }
              };
              const moveBtns = (
                <span className="menu-move">
                  <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => moveTo(i, i - 1)}><Icon name="up" size={15} /></button>
                  <button className="icon-btn" aria-label="Move down" disabled={i === c.rows.length - 1} onClick={() => moveTo(i, i + 1)}><Icon name="down" size={15} /></button>
                </span>
              );
              const cls = cx('menu-item', drag === i && 'dragging', over === i && drag != null && drag !== i && (drag < i ? 'drop-after' : 'drop-before'));
              if (r.kind === 'section')
                return (
                  <div key={key} {...common} className={cx(cls, 'is-section')}>
                    <span className="menu-grip" aria-hidden="true">⋮⋮</span>
                    <span className="menu-sec-line" aria-hidden="true" />
                    <input className="input" value={r.label ?? ''} placeholder="Section heading (optional)" title="Leave empty for just a line" aria-label="Section heading" maxLength={24} onChange={(e) => patchRow(i, { label: e.target.value })} />
                    {moveBtns}
                    <button className="icon-btn" aria-label="Remove this section" title="Remove section (the pages stay)" onClick={() => remove(i)}><Icon name="x" size={15} /></button>
                  </div>
                );
              const def = byId.get(r.id)!;
              const onBar = barIds.includes(r.id);
              const barFull = !onBar && barIds.length >= PHONE_BAR_MAX;
              return (
                <div key={key} {...common} className={cls}>
                  <span className="menu-grip" aria-hidden="true">⋮⋮</span>
                  <span className="menu-icon-wrap">
                    <button className="icon-btn menu-icon" aria-label={`Icon for ${def.label}`} title="Choose an icon" onClick={() => setIconFor(iconFor === r.id ? null : r.id)}>
                      <Icon name={r.icon || def.icon} size={18} />
                    </button>
                    {iconFor === r.id ? (
                      <div className="icon-pick" role="dialog" aria-label="Choose an icon">
                        {MENU_ICONS.map((ic) => (
                          <button key={ic} className={cx('icon-btn', (r.icon || def.icon) === ic && 'on')} aria-label={ic} onClick={() => { patchRow(i, { icon: ic === def.icon ? undefined : ic }); setIconFor(null); }}>
                            <Icon name={ic} size={18} />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </span>
                  <span className="menu-name">
                    <input className="input" value={r.label ?? ''} placeholder={def.label} aria-label={`Name for ${def.label}`} maxLength={28} onChange={(e) => patchRow(i, { label: e.target.value || undefined })} />
                    {r.label ? <small className="muted">{def.label}</small> : null}
                  </span>
                  {r.id !== 'settings' ? (
                    <button
                      className={cx('chip menu-bar-chip', onBar && 'on')}
                      disabled={barFull}
                      aria-pressed={onBar}
                      title={barFull ? `The phone bar has room for ${PHONE_BAR_MAX}` : onBar ? 'In the phone bar: click to take it out' : 'Put it in the phone bar'}
                      onClick={() => toggleBar(r.id)}
                    >
                      Phone bar
                    </button>
                  ) : (
                    <span className="small muted menu-bar-chip">Under More</span>
                  )}
                  {moveBtns}
                  {def.fixed ? (
                    <span className="icon-btn" title="Settings always stays in the menu, so you can come back here" aria-hidden="true"><Icon name="lock" size={14} /></span>
                  ) : (
                    <button className="icon-btn" aria-label={`Remove ${def.label} from the menu`} title="Remove from the menu" onClick={() => remove(i)}><Icon name="x" size={15} /></button>
                  )}
                </div>
              );
            })}
          </div>
          <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setRows([...c.rows, { kind: 'section', id: newSectionId() }])}>
            <Icon name="plus" size={14} /> Add a section
          </button>
        </div>

        <div>
          <div className="menu-col-head">
            <b>Add a page</b>
            <span className="small muted">Pages not in your menu</span>
          </div>
          {AREAS.map(([area, label]) => {
            const left = MENU_ITEMS.filter((x) => x.area === area && !inMenu.has(x.id));
            if (!left.length) return null;
            return (
              <div key={area} className="menu-avail">
                <div className="menu-avail-head">{label}</div>
                {left.map((x) => (
                  <button key={x.id} className="menu-avail-item" onClick={() => add(x.id)}>
                    <Icon name={x.icon} size={18} />
                    <span className="grow">
                      {x.label}
                      <small>{x.desc}</small>
                    </span>
                    <Icon name="plus" size={16} />
                  </button>
                ))}
              </div>
            );
          })}
          {MENU_ITEMS.every((x) => inMenu.has(x.id)) ? <p className="small muted">Every page is in your menu.</p> : null}
          <p className="small muted" style={{ marginTop: 16 }}>
            Everything also stays reachable through Settings. On a phone, the phone-bar items sit next to the Add button; the rest of the menu is under More.
          </p>
        </div>
      </div>
    </section>
  );
}
