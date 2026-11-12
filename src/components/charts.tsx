import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
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

export function CashFlowChart({ data, height = 240, onPick }: { data: Array<{ month: string; income: number; spending: number }>; height?: number; onPick?: (month: string, type: 'income' | 'spending') => void }) {
  return (
    <div>
      <Legend items={[['Income', SERIES[0]], ['Spending', SERIES[1]]]} />
      <div style={{ height }}>
        <ResponsiveContainer>
          <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 12, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#E6EAE8" />
            <XAxis dataKey="month" tickFormatter={shortMonth} tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={compact} tick={AXIS} axisLine={false} tickLine={false} width={44} />
            <Tooltip cursor={{ fill: 'rgba(28,42,57,.05)' }} content={<TipBox title={(m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`} />} />
            <Bar dataKey="income" name="Income" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} cursor={onPick ? 'pointer' : undefined} onClick={(d: any) => onPick?.(d.month ?? d.payload?.month, 'income')} />
            <Bar dataKey="spending" name="Spending" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} cursor={onPick ? 'pointer' : undefined} onClick={(d: any) => onPick?.(d.month ?? d.payload?.month, 'spending')} />
          </BarChart>
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
