import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { fmtMoney, MONTHS } from '../lib/util';

// Validated categorical order (colour-blind separation checked): income, spending, third, fourth.
export const SERIES = ['#2D8A5F', '#9B5BB5', '#C98512', '#2F79B5'];
const AXIS = { fontSize: 12, fill: '#6A7682' };
const shortMonth = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}${m.slice(5, 7) === '01' ? ' ' + m.slice(2, 4) : ''}`;
const compact = (v: number) => {
  const a = Math.abs(v / 100);
  const s = a >= 1000 ? `${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : a.toFixed(0);
  return (v < 0 ? '−' : '') + s;
};

function TipBox({ active, payload, label, title }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #D9DFDC', borderRadius: 8, padding: '8px 12px', fontSize: 13, boxShadow: '0 6px 20px rgba(28,42,57,.12)' }}>
      <div style={{ fontWeight: 650, marginBottom: 4 }}>{title ? title(label) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#3D4B59' }}>
            <span className="swatch" style={{ background: p.color ?? p.stroke }} />
            {p.name}
          </span>
          <span className="money">{fmtMoney(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="legend">
      {items.map(([label, color]) => (
        <span key={label}>
          <span className="swatch" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

/** Income next to what went out: reservations & savings stacked under spending. */
export function CashFlowChart({ data, height = 240, onPick }: { data: Array<{ month: string; income: number; spending: number; reserved: number }>; height?: number; onPick?: (month: string, type: 'income' | 'spending' | 'reserved') => void }) {
  const pick = (type: 'income' | 'spending' | 'reserved') => (d: any) => onPick?.(d.month ?? d.payload?.month, type);
  return (
    <div>
      <Legend items={[['Income', SERIES[0]], ['Reservations & savings', SERIES[2]], ['Spending', SERIES[1]]]} />
      <div style={{ height }}>
        <ResponsiveContainer>
          <BarChart data={data} barGap={2} barCategoryGap="26%" margin={{ top: 12, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#E6EAE8" />
            <XAxis dataKey="month" tickFormatter={shortMonth} tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={compact} tick={AXIS} axisLine={false} tickLine={false} width={44} />
            <Tooltip cursor={{ fill: 'rgba(28,42,57,.05)' }} content={<TipBox title={(m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`} />} />
            <Bar dataKey="income" name="Income" stackId="in" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} cursor={onPick ? 'pointer' : undefined} onClick={pick('income')} />
            <Bar dataKey="reserved" name="Reservations & savings" stackId="out" fill={SERIES[2]} stroke="#fff" strokeWidth={1} maxBarSize={22} isAnimationActive={false} cursor={onPick ? 'pointer' : undefined} onClick={pick('reserved')} />
            <Bar dataKey="spending" name="Spending" stackId="out" fill={SERIES[1]} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} cursor={onPick ? 'pointer' : undefined} onClick={pick('spending')} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const monthTitle = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Income stacked by source (in your order and colours) with everything that went out as a line. */
export function IncomeOutChart({ data, sources, height = 320, lineName = 'Spending incl. reservations & savings' }: { data: Array<Record<string, any>>; sources: Array<{ key: string; name: string; color: string }>; height?: number; lineName?: string }) {
  return (
    <div>
      <Legend items={[...sources.map((s) => [s.name, s.color] as [string, string]), [lineName, LINE]]} />
      <div style={{ height }}>
        <ResponsiveContainer>
          <ComposedChart data={data} barCategoryGap="22%" margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#E6EAE8" />
            <XAxis dataKey="month" tickFormatter={shortMonth} tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={compact} tick={AXIS} axisLine={false} tickLine={false} width={48} />
            <Tooltip cursor={{ fill: 'rgba(28,42,57,.05)' }} content={<StackTip lineKey="out" />} />
            {sources.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} stackId="in" fill={s.color} stroke="#fff" strokeWidth={1} maxBarSize={38} radius={i === sources.length - 1 ? [4, 4, 0, 0] : undefined} isAnimationActive={false} />
            ))}
            <Line dataKey="out" name={lineName} type="linear" stroke={LINE} strokeWidth={2.5} dot={{ r: 3.5, fill: LINE, stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
const LINE = '#1C2A39';

function StackTip({ active, payload, label, lineKey }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const bars = payload.filter((p: any) => p.dataKey !== lineKey && p.value);
  const income = bars.reduce((a: number, p: any) => a + p.value, 0);
  const out = row[lineKey] ?? 0;
  return (
    <div style={{ background: '#fff', border: '1px solid #D9DFDC', borderRadius: 8, padding: '8px 12px', fontSize: 13, boxShadow: '0 6px 20px rgba(28,42,57,.12)', minWidth: 220 }}>
      <div style={{ fontWeight: 650, marginBottom: 4 }}>{monthTitle(label)}</div>
      {[...bars].reverse().map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#3D4B59' }}>
            <span className="swatch" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="money">{fmtMoney(p.value)}</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #E6EAE8', marginTop: 4, paddingTop: 4, fontWeight: 600 }}>
        <span>Income</span>
        <span className="money">{fmtMoney(income)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Out (incl. reservations)</span>
        <span className="money">{fmtMoney(out)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 650, color: income - out < 0 ? '#7A3B5E' : '#2F6B4F' }}>
        <span style={{ marginRight: 12 }}>{income - out < 0 ? 'Spent more than came in' : 'Left'}</span>
        <span className="money">{fmtMoney(Math.abs(income - out))}</span>
      </div>
    </div>
  );
}

/** One series over time with its average as a straight line. */
export function AverageChart({ data, name, color, avg, height = 300 }: { data: Array<{ month: string; value: number }>; name: string; color: string; avg: number; height?: number }) {
  return (
    <div>
      <Legend items={[[name, color], [`Average ${fmtMoney(avg)}`, '#6A7682']]} />
      <div style={{ height }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#E6EAE8" />
            <XAxis dataKey="month" tickFormatter={shortMonth} tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={compact} tick={AXIS} axisLine={false} tickLine={false} width={48} />
            <ReferenceLine y={avg} stroke="#6A7682" strokeDasharray="6 4" strokeWidth={1.5} />
            <Tooltip cursor={{ stroke: '#9AA5AE', strokeDasharray: '3 3' }} content={<TipBox title={monthTitle} />} />
            <Line dataKey="value" name={name} type="linear" stroke={color} strokeWidth={2.5} dot={{ r: 3.5, fill: color, stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function TrendChart({ data, series, height = 220, zero }: { data: Array<Record<string, any>>; series: Array<{ key: string; name: string; color: string }>; height?: number; zero?: boolean }) {
  return (
    <div>
      {series.length > 1 ? <Legend items={series.map((s) => [s.name, s.color])} /> : null}
      <div style={{ height }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#E6EAE8" />
            <XAxis dataKey="month" tickFormatter={shortMonth} tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={compact} tick={AXIS} axisLine={false} tickLine={false} width={48} />
            {zero ? <ReferenceLine y={0} stroke="#9AA5AE" strokeDasharray="3 3" /> : null}
            <Tooltip cursor={{ stroke: '#9AA5AE', strokeDasharray: '3 3' }} content={<TipBox title={(m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`} />} />
            {series.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function HBars({ rows, color = SERIES[1], onPick }: { rows: Array<{ label: string; value: number; sub?: string; id?: string }>; color?: string; onPick?: (r: { label: string; value: number; id?: string }) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="stack" style={{ ['--gap' as any]: '8px' }}>
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${fmtMoney(r.value)}`} onClick={() => onPick?.(r)} style={{ cursor: onPick ? 'pointer' : undefined }} role={onPick ? 'button' : undefined} tabIndex={onPick ? 0 : undefined} onKeyDown={(e) => e.key === 'Enter' && onPick?.(r)}>
          <div className="row small" style={{ justifyContent: 'space-between' }}>
            <span>
              {r.label}
              {r.sub ? <span className="muted"> · {r.sub}</span> : null}
            </span>
            <span className="money">{fmtMoney(r.value)}</span>
          </div>
          <div style={{ height: 8, background: 'var(--sunk)', borderRadius: 4, marginTop: 4 }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: color, borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
