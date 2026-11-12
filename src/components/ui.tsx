import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { cx, fmtMoney, parseAmount, fromMinor } from '../lib/util';

// ---------- icons (inline, 20px, stroke) ----------
const P: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  accounts: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  budget: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  repeat: <path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />,
  forecast: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  report: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M8 17v-3M12 17v-6M16 17v-2" />
    </>
  ),
  import: <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="M5 12l5 5 9-10" />,
  chev: <path d="M9 6l6 6-6 6" />,
  chevl: <path d="M15 6l-6 6 6 6" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  transfer: <path d="M7 7h13l-3-3M17 17H4l3 3" />,
  split: <path d="M6 3v6a6 6 0 0 0 6 6h6M18 21l3-3-3-3M6 21v-6" />,
  lock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  cloud: <path d="M7 18a5 5 0 0 1-.6-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </>
  ),
  envelope: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  download: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
  scale: <path d="M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zM19 7l-3 7a4 4 0 0 0 6 0zM8 21h8" />
};
export function Icon({ name, size = 20, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}

// ---------- money ----------
export function Money({ v, cur, sign, tone, compact, className }: { v: number; cur?: string; sign?: boolean; tone?: boolean; compact?: boolean; className?: string }) {
  return (
    <span className={cx('money', tone && v > 0 && 'pos', tone && v < 0 && 'neg', className)}>
      {fmtMoney(v, cur ?? 'RON', { sign, compact })}
      {cur && cur !== 'RON' ? <span className="cur">{cur}</span> : null}
    </span>
  );
}

// ---------- inputs ----------
export function Field({ label, help, children, className }: { label: string; help?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('field', className)}>
      <span>{label}</span>
      {children}
      {help ? <small className="help">{help}</small> : null}
    </label>
  );
}

/** Amount input that keeps what the user typed until blur. Value in minor units. */
export function AmountInput({ value, onChange, className, inline, autoFocus, placeholder, ariaLabel }: { value: number; onChange: (v: number) => void; className?: string; inline?: boolean; autoFocus?: boolean; placeholder?: string; ariaLabel?: string }) {
  const show = (v: number) => (v ? fmtMoney(v) : '');
  const [text, setText] = useState(show(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(show(value));
  }, [value, focus]);
  return (
    <input
      className={cx('input num', inline && 'inline', className)}
      inputMode="decimal"
      value={text}
      aria-label={ariaLabel}
      placeholder={placeholder ?? '0.00'}
      autoFocus={autoFocus}
      onFocus={(e) => {
        setFocus(true);
        // switch to the plain number for editing, unless something was already typed
        setText((prev) => (prev === show(value) ? (value ? fromMinor(value).toFixed(2) : '') : prev));
        const el = e.currentTarget;
        requestAnimationFrame(() => el.select());
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocus(false);
        const v = parseAmount(text);
        onChange(v ?? 0);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function Seg<T extends string>({ value, options, onChange, ariaLabel }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; ariaLabel?: string }) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map(([k, l]) => (
        <button key={k} type="button" className={cx(value === k && 'on')} aria-pressed={value === k} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

// ---------- dialog ----------
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('dialog', wide && 'wide')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function Meter({ value, max, over }: { value: number; max: number; over?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : value > 0 ? 100 : 0;
  return (
    <div className={cx('meter', (over ?? value > max) && max >= 0 && value > max && 'over')} role="img" aria-label={`${Math.round(pct)}%`}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------- toast ----------
interface ToastMsg {
  text: string;
  action?: { label: string; run: () => void };
}
const ToastCtx = createContext<(t: ToastMsg | string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<ToastMsg | null>(null);
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => setT(null), t.action ? 6000 : 3000);
    return () => clearTimeout(h);
  }, [t]);
  return (
    <ToastCtx.Provider value={(x) => setT(typeof x === 'string' ? { text: x } : x)}>
      {children}
      {t ? (
        <div className="toast" role="status">
          {t.text}
          {t.action ? (
            <button
              onClick={() => {
                t.action!.run();
                setT(null);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Confirm({ title, body, confirm, danger, onYes, onClose }: { title: string; body: ReactNode; confirm: string; danger?: boolean; onYes: () => void; onClose: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={cx('btn', danger ? 'danger' : 'primary')}
            onClick={() => {
              onYes();
              onClose();
            }}
          >
            {confirm}
          </button>
        </>
      }
    >
      <p>{body}</p>
    </Modal>
  );
}
