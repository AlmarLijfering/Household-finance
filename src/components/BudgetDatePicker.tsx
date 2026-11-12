import { useEffect, useRef, useState } from 'react';
import type { Model } from '../lib/calc/model';
import { lastBookableDate, monthOfDate, period, weekOfPeriod } from '../lib/calc/period';
import { addDays, addMonths, cx, fmtDate, isoDate, MONTHS, MONTHS_LONG, parseISO, today } from '../lib/util';
import { Icon } from './ui';

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const short = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]}${month.slice(5, 7) === '01' ? ' ' + month.slice(2, 4) : ''}`;

/**
 * Date field whose calendar shows budget months: each budget month has its own tint, every
 * row is labelled with its budget month and week, and days that cannot be booked yet are off.
 */
export function BudgetDatePicker({ m, value, onChange, max, ariaLabel }: { m: Model; value: string; onChange: (d: string) => void; max?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(value.slice(0, 7)); // calendar month shown
  const ref = useRef<HTMLDivElement>(null);
  const limit = max ?? lastBookableDate(m);
  useEffect(() => {
    if (!open) return;
    setView(value.slice(0, 7));
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  // six rows of Monday–Sunday covering the calendar month on view
  const first = parseISO(`${view}-01`);
  const lead = (first.getDay() + 6) % 7;
  const gridStart = isoDate(new Date(first.getFullYear(), first.getMonth(), 1 - lead));
  const rows = Array.from({ length: 6 }, (_, r) => Array.from({ length: 7 }, (_, c) => addDays(gridStart, r * 7 + c)));
  const bm = monthOfDate(m, value);
  const months = Array.from(new Set(rows.flat().map((d) => monthOfDate(m, d))));
  const tint = (month: string) => (Number(month.slice(5, 7)) % 2 ? 'bm-a' : 'bm-b');

  return (
    <div className="bdp" ref={ref}>
      <button type="button" className="input bdp-field" aria-label={ariaLabel ?? 'Date'} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{fmtDate(value, true)}</span>
        <span className="bdp-tag">
          {short(bm)} · wk {weekOfPeriod(m, value)}
        </span>
        <Icon name="calendar" size={16} />
      </button>
      {open ? (
        <div className="bdp-pop" role="dialog" aria-label="Choose a date">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setView(addMonths(`${view}-01`, -1).slice(0, 7))}>
              <Icon name="chevl" size={18} />
            </button>
            <b>
              {MONTHS_LONG[Number(view.slice(5, 7)) - 1]} {view.slice(0, 4)}
            </b>
            <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setView(addMonths(`${view}-01`, 1).slice(0, 7))}>
              <Icon name="chev" size={18} />
            </button>
          </div>
          <table className="bdp-grid">
            <thead>
              <tr>
                <th className="bdp-wk">Budget</th>
                {DOW.map((d) => (
                  <th key={d}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const mon = row[0];
                const rowMonth = monthOfDate(m, mon);
                const startsHere = row.some((d) => period(m, monthOfDate(m, d)).start === d);
                return (
                  <tr key={mon} className={cx(startsHere && 'bdp-boundary')}>
                    <td className={cx('bdp-wk', tint(rowMonth))}>
                      {short(rowMonth)} {weekOfPeriod(m, mon)}
                    </td>
                    {row.map((d) => {
                      const dm = monthOfDate(m, d);
                      const off = d > limit;
                      const outside = d.slice(0, 7) !== view;
                      return (
                        <td key={d}>
                          <button
                            type="button"
                            disabled={off}
                            className={cx('bdp-day', tint(dm), d === value && 'sel', d === today() && 'today', outside && 'outside', period(m, dm).start === d && 'first')}
                            onClick={() => {
                              onChange(d);
                              setOpen(false);
                            }}
                            title={`${fmtDate(d, true)} · budget ${MONTHS_LONG[Number(dm.slice(5, 7)) - 1]} ${dm.slice(0, 4)}, week ${weekOfPeriod(m, d)}${off ? ' · not open for booking yet' : ''}`}
                          >
                            {Number(d.slice(8, 10))}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="bdp-legend">
            {months.map((mm) => (
              <span key={mm}>
                <span className={cx('swatch', tint(mm))} /> {MONTHS_LONG[Number(mm.slice(5, 7)) - 1]}: {fmtDate(period(m, mm).start)} – {fmtDate(period(m, mm).end)}
              </span>
            ))}
            <span>
              <span className="swatch bdp-off-swatch" /> Not open yet (after {fmtDate(limit, true)})
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
