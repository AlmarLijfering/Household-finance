// Reading Excel workbooks into plain row objects. Works in the browser and in Node (tests).
import type ExcelJS from 'exceljs';

export type Cell = string | number | boolean | Date | null;
export interface TableData {
  sheet: string;
  name: string;
  ref: string;
  headers: string[];
  rows: Array<{ rowNumber: number; values: Record<string, Cell>; raw: Cell[] }>;
}
export interface WorkbookData {
  fileName: string;
  sheets: string[];
  tables: TableData[];
  cell: (sheet: string, addr: string) => Cell;
  formula: (sheet: string, addr: string) => string | null;
}

export async function loadExcel(): Promise<typeof ExcelJS> {
  const mod: any = await import('exceljs');
  return (mod.default ?? mod) as typeof ExcelJS;
}

export function cellValue(v: unknown): Cell {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as any;
    if ('result' in o) return cellValue(o.result);
    if ('formula' in o || 'sharedFormula' in o) return null; // formula without cached value
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text).join('');
    if ('text' in o) return String(o.text);
    if ('error' in o) return null;
    return null;
  }
  return v as Cell;
}

function decode(ref: string) {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref.replace(/\$/g, ''));
  if (!m) return null;
  const col = (s: string) => s.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
  return { c1: col(m[1]), r1: Number(m[2]), c2: col(m[3]), r2: Number(m[4]) };
}

export async function readWorkbook(data: ArrayBuffer, fileName: string): Promise<WorkbookData> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  await wb.xlsx.load(data as any);
  const tables: TableData[] = [];
  for (const ws of wb.worksheets) {
    const list: any[] = (ws as any).getTables ? (ws as any).getTables() : [];
    for (const entry of list) {
      const t = entry.table ?? entry;
      const ref: string = t.tableRef ?? t.ref;
      const d = ref && decode(ref);
      if (!d) continue;
      const headerRow = ws.getRow(d.r1);
      const headers: string[] = [];
      for (let c = d.c1; c <= d.c2; c++) headers.push(String(cellValue(headerRow.getCell(c).value) ?? `Column ${c - d.c1 + 1}`).trim());
      const rows: TableData['rows'] = [];
      for (let r = d.r1 + 1; r <= d.r2; r++) {
        const row = ws.getRow(r);
        const raw: Cell[] = [];
        const values: Record<string, Cell> = {};
        for (let c = d.c1; c <= d.c2; c++) {
          const v = cellValue(row.getCell(c).value);
          raw.push(v);
          values[headers[c - d.c1]] = v;
        }
        if (raw.every((v) => v == null || v === '')) continue;
        rows.push({ rowNumber: r, values, raw });
      }
      tables.push({ sheet: ws.name, name: t.name ?? t.displayName, ref, headers, rows });
    }
  }
  return {
    fileName,
    sheets: wb.worksheets.map((w) => w.name),
    tables,
    cell: (sheet, addr) => {
      const ws = wb.getWorksheet(sheet);
      return ws ? cellValue(ws.getCell(addr).value) : null;
    },
    formula: (sheet, addr) => {
      const ws = wb.getWorksheet(sheet);
      const v: any = ws?.getCell(addr).value;
      return v && typeof v === 'object' && 'formula' in v ? String(v.formula) : null;
    }
  };
}

export const str = (v: Cell) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());
export const num = (v: Cell): number | null => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
