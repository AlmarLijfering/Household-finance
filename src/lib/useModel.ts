import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext } from 'react';
import { db } from './db';
import { buildModel, DEFAULT_SETTINGS, type Model } from './calc/model';

export function useLiveModel(): Model | undefined {
  return useLiveQuery(async () => {
    const [settings, accounts, groups, categories, transactions, budgetLines, recurring, planned, scenarios, yearlyItems, yearlyFunds, fxRates, reconciliations, importBatches, monthPlans] = await Promise.all([
      db.settings.get('settings'),
      db.accounts.toArray(),
      db.groups.toArray(),
      db.categories.toArray(),
      db.transactions.toArray(),
      db.budgetLines.toArray(),
      db.recurring.toArray(),
      db.planned.toArray(),
      db.scenarios.toArray(),
      db.yearlyItems.toArray(),
      db.yearlyFunds.toArray(),
      db.fxRates.toArray(),
      db.reconciliations.toArray(),
      db.importBatches.toArray(),
      db.monthPlans.toArray()
    ]);
    return buildModel({
      settings: settings ?? DEFAULT_SETTINGS,
      accounts,
      groups,
      categories,
      transactions,
      budgetLines,
      recurring,
      planned,
      scenarios,
      yearlyItems,
      yearlyFunds,
      fxRates,
      reconciliations,
      importBatches,
      monthPlans
    });
  }, []);
}

export const ModelCtx = createContext<Model | null>(null);
export function useModel(): Model {
  const m = useContext(ModelCtx);
  if (!m) throw new Error('Model not loaded');
  return m;
}
