import { db } from './db';
import { useLiveModel, loadModel } from './useModel';
import { buildDataWorkbook, buildReportWorkbook, defaultReportRange } from './excel/reports';
import { upload } from './sync/graph';
import { loadState } from './sync/sync';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function loadModelOnce() {
  return loadModel();
}

/** Rebuild and upload the predefined Excel reports from committed data. */
export async function publishReports() {
  const s = await loadState();
  if (!s.location) return;
  const m = await loadModelOnce();
  const range = { ...defaultReportRange(m), revision: s.revision };
  const report = await buildReportWorkbook(m, range);
  await upload(s.location, 'Reports/Household Reports.xlsx', new Blob([report], { type: XLSX }), undefined, XLSX);
  const data = await buildDataWorkbook(m, range);
  await upload(s.location, 'Reports/Household Data.xlsx', new Blob([data], { type: XLSX }), undefined, XLSX);
}
void useLiveModel;
