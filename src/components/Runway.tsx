import type { Runway as R } from '../lib/calc/budget';
import { fmtMoney } from '../lib/util';
import { Money } from './ui';

/**
 * The month on one bar, drawn to scale:
 * money you have now + income still to come, against what is still to be paid.
 */
export function Runway({ r, title, note, startLabel }: { r: R; title: string; note?: string; startLabel?: string }) {
  const inflow = Math.max(0, r.available) + Math.max(0, r.incomeToCome);
  const total = Math.max(inflow, r.costsToPay, 1);
  const pct = (v: number) => `${(Math.max(0, v) / total) * 100}%`;
  const short = r.costsToPay > inflow;
  return (
    <section className="runway" aria-label={title}>
      <div className="runway-top">
        <div className="runway-free">
          <div className="label">{title}</div>
          <div className={`figure ${r.free < 0 ? 'neg' : 'pos'}`}>
            {fmtMoney(r.free)}
            <span className="cur"> {'RON'}</span>
          </div>
          {note ? <p className="muted small" style={{ marginTop: 6, maxWidth: '52ch' }}>{note}</p> : null}
        </div>
        <dl className="runway-legend">
          <dt>
            <span className="swatch seg-have" /> {startLabel ?? 'In current accounts and cash'}
          </dt>
          <dd>
            <Money v={r.available} />
          </dd>
          <dt>
            <span className="swatch seg-come" /> Income still to come
          </dt>
          <dd>
            <Money v={r.incomeToCome} />
          </dd>
          <dt>
            <span className="swatch seg-pay" /> Still to pay or set aside
          </dt>
          <dd>
            <Money v={-r.costsToPay} />
          </dd>
        </dl>
      </div>
      <div className="runway-bar" role="img" aria-label={`Available ${fmtMoney(inflow)}, committed ${fmtMoney(r.costsToPay)}, free ${fmtMoney(r.free)}`}>
        <div className="seg-have" style={{ width: pct(r.available) }} title={`Now: ${fmtMoney(r.available)}`} />
        <div className="seg-come" style={{ width: pct(r.incomeToCome) }} title={`To come: ${fmtMoney(r.incomeToCome)}`} />
      </div>
      <div className="runway-bar" style={{ marginTop: 6, height: 18 }} aria-hidden="true">
        <div className="seg-pay" style={{ width: pct(Math.min(r.costsToPay, inflow)) }} title={`Committed: ${fmtMoney(r.costsToPay)}`} />
        {short ? <div className="seg-short" style={{ width: pct(r.costsToPay - inflow) }} /> : null}
      </div>
      <div className="runway-scale">
        <span>0</span>
        <span>{short ? `Short by ${fmtMoney(r.costsToPay - inflow)}` : `${fmtMoney(r.free)} left after everything planned`}</span>
        <span>{fmtMoney(total, 'RON', { compact: true })}</span>
      </div>
    </section>
  );
}
