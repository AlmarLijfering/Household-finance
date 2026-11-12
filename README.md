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
| Accounts | Current accounts, cash and reserve funds (Taxes, Yearly expenses, Oxygen line, Holiday…). Registers with running balance and search. You type in the bank balance yourself; the app shows the difference with its own balance on that date and lets you add the missing transaction by hand. No clearing or automatic reconciliation. | Account sheets, "Actual Amount" column |
| Transactions | Income, expenses, transfers (linked pairs) and split transactions. Payee autocomplete fills in the last category used. Transfers can carry a reservation category so setting money aside counts in the budget. Filter by month, type, account and category. | Account sheets |
| Category end date | A category can have an "Active until" date. After it you cannot book on it (pickers leave it out for later dates; saving or mass updating a later-dated transaction is blocked or skipped), and budget months that start after it leave it out — even if a line was set up before — including totals, the year view, copying and the forecast. Earlier months keep it. |
| Mass update | Tick transactions in any list (or select all shown after filtering) → Edit selected: change account, category, budget month, payee and/or date. The type never changes; transfers keep both sides in step; transactions a change does not fit (e.g. an expense category on money in, a different currency) are skipped and listed; one-click Undo. | — |
| Categories | Add, edit, archive. Each category can be limited to account types (e.g. reserve funds) or to specific accounts, so pickers only show what belongs there. "Set scopes from history" proposes this from past use. New categories can also be created from any category picker. | Lookups / Category |
| Drill-down | Every month figure (budget Actual, Balance rows, report cells, cash-flow bars, top spending) opens the transactions behind it. | — |
| Booking for a month | A transaction can count for another budget month than its date ("Counts for budget month"), e.g. the salary advance received on 25 Nov counts for December. It then belongs only to that month: its budget, actuals and balance. Bookings are open up to the next budget month; later months are planning only. The date picker shows budget months (tinted), their weeks, and greys out days that cannot be booked yet. | Moving advances to next month by hand |
| Earmark check | Bills & income items can be set to count for the next budget month (e.g. Salary advance); recording them fills that in. Transactions that are late in their budget month and look like they belong to the next one — matching such an item, or a payee/category you moved forward before — are flagged "Not earmarked?" with one-click "Count for <next month>" or "It's right". A reminder shows on the overview and a filter on Transactions. | — |
| Budget months | Each budget month has its own first and last day. Default: whole weeks starting on the Monday nearest the 1st (as in the workbook); change any month on the Budget page or switch to calendar months in Settings. Weeks, actuals, reports and the forecast all follow these dates. The importer takes the dates from each budget sheet. | Week dates on the budget sheets |
| Budget | Month view with Baseline / Estimate / Actual / Remaining / Closed per line, all editable inline, grouped by your sections (Bucharest, Floresti, Joshua, Car…). The Balance block starts with the money the month has: for the current and past months everything booked for that month or earlier (never money meant for later months); for next month a "Carry over" line with this month's projected free money plus what is already booked for next month; two or more months ahead it starts at 0. Weekly food lines, per-category rollover, unbudgeted spending. Year view with annual totals and "spread an annual amount over the months". | Budget Jan…Dec sheets |
| Bills & income | Recurring bills, subscriptions, income and transfers. "Paid" / "Received" opens a prefilled transaction you can adjust before it is recorded. Each item shows its past payments, found by payee (or recorded from it), with last, average and year-to-date. Paused or ended items move to a separate Inactive list: nothing to pay, history still visible. | Digital_Subscriptions, Rocket Money recurring |
| Export | Settings → Data → Export everything to Excel (transactions, accounts with bank difference, categories, budgets, bills, yearly items, plans), and Export to Excel on the Transactions page for the filtered list. | — |
| Yearly expenses | Once-a-year costs with due dates, paid flags and the fund balance: fund + contributions still to come − remaining costs. | Budget Yearly Expenses |
| Yearly expenses: linking | Each yearly item has its own category (YE001…; "Give every item a category" creates them for imported items). Open an item to link its payments: suggestions come from the yearly fund, "Yearly expenses (paid)" and the item's name; linking gives those transactions the item's category, and the actual comes from them (the amount typed in is only a fallback). | — |
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
