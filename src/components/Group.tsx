import type { CSSProperties } from 'react';
import type { Model } from '../lib/calc/model';
import type { ID } from '../lib/types';

/**
 * One colour per category group, used as a small marker next to the group or category name
 * (never as the only cue: the name is always shown). The four main ones follow the chart palette.
 */
export const GROUP_COLOR: Record<string, string> = {
  IC: '#2D8A5F', // income
  PC: '#2F79B5', // planned costs
  RE: '#C98512', // reservations
  UC: '#9B5BB5', // unplanned costs
  YE: '#1F8A8A', // yearly expenses
  DIV: '#6B7785', // paid from reserves
  TR: '#8A94A0',
  SB: '#8A94A0'
};
export const groupColor = (code?: string | null) => GROUP_COLOR[code ?? ''] ?? '#8A94A0';
export const groupVar = (code?: string | null) => ({ ['--g' as any]: groupColor(code) }) as CSSProperties;

export function GroupDot({ code, title }: { code?: string | null; title?: string }) {
  return <span className="gdot" style={groupVar(code)} title={title} aria-hidden="true" />;
}

/** Category name with its group marker. */
export function CatChip({ m, categoryId, fallback }: { m: Model; categoryId: ID | null | undefined; fallback?: string }) {
  const c = categoryId ? m.categoryById.get(categoryId) : undefined;
  if (!c) return <span className="cat-chip none">{fallback ?? 'Uncategorised'}</span>;
  const g = m.groupById.get(c.groupId);
  return (
    <span className="cat-chip" title={`${g?.name ?? ''} · ${c.code}`}>
      <GroupDot code={g?.code} />
      {c.name}
    </span>
  );
}
