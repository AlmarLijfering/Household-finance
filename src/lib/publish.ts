import { db } from './db';
import { useLiveModel } from './useModel';
import { buildModel, DEFAULT_SETTINGS } from './calc/model';
import { buildDataWorkbook, buildReportWorkbook, defaultReportRange } from './excel/reports';
import { upload } from './sync/graph';
import { loadState } from './sync/sync';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function loadModelOnce() {
  const [settings, accounts, groups, categories, transactions, budgetLines, recurring, planned, scenarios, yearlyItems, yearlyFunds, fxRates, reconciliations, importBatches, monthPlans] = await Promise.all([
    db.settings.get('settings'), db.accounts.toArray(), db.groups.toArray(), db.categories.toArray(), db.transactions.toArray(), db.budgetLines.toArray(), db.recurring.toArray(), db.planned.toArray(), db.scenarios.toArray(), db.yearlyItems.toArray(), db.yearlyFunds.toArray(), db.fxRates.toArray(), db.reconciliations.toArray(), db.importBatches.toArray(), db.monthPlans.toArray()
  ]);
  return buildModel({ settings: settings ?? DEFAULT_SETTINGS, accounts, groups, categories, transactions, budgetLines, recurring, planned, scenarios, yearlyItems, yearlyFunds, fxRates, reconciliations, importBatches, monthPlans });
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
