# Household Finance

A personal finance app for the two of you: accounts and day-to-day spending, monthly and annual budgets, recurring bills and income, the yearly-expenses fund, forecasts with scenarios, and Excel reports. It replaces the Budget 2026 / budget 2027 workbooks and keeps their logic.

It runs as an installable web app (PWA) on Windows, macOS, iPhone and iPad. There is no server. Data is stored on each device and synced through one encrypted file in a shared OneDrive Personal folder.

## Try it locally

```bash
npm install
npm run dev        # http://localhost:5173
```

On the first screen you can import your workbook, start fresh with your usual accounts and categories, or load sample data to look around. Without OneDrive sync, everything stays in that browser.

```bash
npm test           # unit tests; the import tests also run against your workbooks:
WORKBOOK_DIR="/path/to/folder/with/the/xlsx" npm test
npm run build      # production build in dist/
```

To turn on sync and sharing, follow **SETUP.md**. That covers the Microsoft app registration, free hosting and inviting your partner.

## What's in it

| Area | What it does | Comes from |
|---|---|---|
| Overview | The month at a glance: free money at month end (your workbook's AC/Remainder row), cash flow, budget left, reserve funds, bills due, savings trend. Filter by account and period. | Rocket Money dashboard, "Balance" block |
| Accounts | Current accounts, cash and reserve funds (Taxes, Yearly expenses, Oxygen line, Holiday…). Registers with running balance, search, cleared/reconciled status, reconciliation against the bank statement. | Account sheets, "Actual Amount" column, Microsoft Money registers |
| Transactions | Income, expenses, transfers (linked pairs) and split transactions. Payee autocomplete fills in the last category used. Transfers can carry a reservation category so setting money aside counts in the budget. Filter by month, type, account and category. | Account sheets |
| Categories | Add, edit, archive. Each category can be limited to account types (e.g. reserve funds) or to specific accounts, so pickers only show what belongs there. "Set scopes from history" proposes this from past use. New categories can also be created from any category picker. | Lookups / Category |
| Drill-down | Every month figure (budget Actual, Balance rows, report cells, cash-flow bars, top spending) opens the transactions behind it. | — |
| Budget | Month view with Baseline / Estimate / Actual / Remaining / Closed per line, all editable inline, grouped by your sections (Bucharest, Floresti, Joshua, Car…). The Balance block starts with "In current accounts and cash": today's balance for the current month, the month-end balance for past months, and 0 for a month that has not started (your own starting estimate is used if you enter one). Copying a month carries a positive remainder into "Remainder last month". Weekly food lines, per-category rollover, unbudgeted spending. Year view with annual totals and "spread an annual amount over the months". | Budget Jan…Dec sheets |
| Bills & income | Recurring bills, subscriptions, income and transfers. "Paid" / "Received" opens a prefilled transaction you can adjust (amount, date, account, category) before it is recorded; the schedule moves on when you save. Monthly cost of subscriptions. | Digital_Subscriptions, Rocket Money recurring |
| Yearly expenses | Once-a-year costs with due dates, paid flags and the fund balance: fund + contributions still to come − remaining costs. | Budget Yearly Expenses |
| Forecast | Month-end balance projection for 6–24 months, everyday money or everything, with scenarios (income/spending % changes plus extra one-offs and recurring items) and planned entries kept apart from actuals. | budget 2027 workbook |
| Reports | Cash flow (monthly/annual), income and spending by category, account balances, budget vs actual, transaction detail. Download as Excel; published automatically to OneDrive after every sync. | Expenses per Month, Total_* tables |
| Import | Preview, mapping, validation, duplicate detection, reconciliation against the workbook's own balances, commit, undo. Repeatable. | — |

Stocks, investment funds and portfolios are deliberately out of scope. The importer skips those sheets.

## Project layout

```
src/
  lib/
    types.ts            data model
    db.ts               IndexedDB (Dexie) + the pending-edits queue
    calc/               budget rules, balances, recurring, forecast, reports, yearly fund
    importer/           workbook reader, parser for both workbook layouts, commit/undo
    excel/reports.ts    report workbook generation (structured Tables)
    sync/               Microsoft sign-in & Graph, encryption, sync engine
    seed.ts, structure.ts   your category/account structure and sample data
  pages/                one file per screen
  components/           shared UI (transaction editor, runway bar, charts, tables)
tests/                  calculation, encryption, import and two-device sync tests
```

See **DESIGN.md** for the architecture, the Excel mapping and the open release gates.
