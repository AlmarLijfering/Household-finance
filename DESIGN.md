# Design notes

## Architecture

```
 Device (PWA: React + TypeScript + Vite)            OneDrive Personal (owner's drive, shared with partner)
 ┌───────────────────────────────────────┐          ┌───────────────────────────────────────────────┐
 │ IndexedDB (Dexie)                     │          │ Household Finance/                            │
 │  · tables: accounts, transactions, …  │  Graph   │   Data/household.json   ← one encrypted       │
 │  · pending: retained edits (ops)      │ ───────▶ │                           snapshot (If-Match) │
 │  · kv: sync state, non-extractable key│  If-Match│   Data/keyring.json     ← wrapped data keys   │
 │                                       │ ◀─────── │   Backups/household-*.json (daily, encrypted) │
 │ calc/ (pure functions on a Model)     │          │   Reports/Household Reports.xlsx (readable)   │
 │ excel/ (ExcelJS in the browser)       │ ───────▶ │   Reports/Household Data.xlsx   (readable)    │
 └───────────────────────────────────────┘          └───────────────────────────────────────────────┘
```

Static hosting serves the app shell. MSAL handles delegated sign-in with personal accounts (PKCE, redirect flow, which works in installed iOS apps). There is no backend.

## Data model (src/lib/types.ts)

- Money is stored as **integer minor units** in the account's currency. Reports convert to the base currency (RON) with the BNR rate on or before the date.
- **Account**: `current | cash | reserve | savings`, keeping the workbook code (CUR001, RES003…), plus opening balance and the last bank balance entered.
- **Category** belongs to a **group** with a kind: Income (IC), Planned costs (PC), Reservations (RE), Unplanned costs (UC), Yearly expenses (YE), Paid from reserves (DIV), Transfers, Opening balances. The budget **section** (Bucharest, Floresti, Joshua…) and the rollover setting live on the category.
- **Transaction**: signed amount, payee, memo, category *or* splits, status (uncleared/cleared/reconciled). A **transfer** is two transactions sharing `transferId`. Only the outgoing side may carry a category; setting money aside into Taxes uses RE011, which is how the workbook counted reservations.
- **BudgetLine**: month, category, optional label and week (1–5), baseline, estimate, closed.
- **Recurring**, **PlannedEntry** (future, never touches balances), **Scenario**, **YearlyItem/YearlyFund**, **FxRate**, **Reconciliation**, **ImportBatch**.

## Workbook rules reproduced

| Workbook | App |
|---|---|
| `Remainder = IF(OR(Closed, Actual >= Estimated), 0, Estimated − Actual)` | `remainingOf()` in calc/budget.ts, the same rule |
| Actual = −SUMIFS(Total_Category, sub code, month) | sum of category lines in the month, sign-normalised per group |
| Food Week 1…5 lines | budget lines with `week`; a week line counts only that week's transactions (days 1–7, 8–14, …) |
| AC row: current accounts − compensation | Runway: current + cash balances now, plus income remaining, minus costs remaining |
| Balance row = (AC + IC) − (PC + RE + UC) | `runway.free`. Verified: November 2026 gives −2,880.00 in both |
| Yearly Expenses: account + planned contributions − remaining | `yearlyPlan()`: fund balance + monthly contribution × months left − remaining items |
| Accounts: Actual Amount vs computed → Difference | statement balance on the account, plus a full reconciliation workflow |
| Expenses per Month | Reports → Spending by category, and the `SpendingByCategory` table in Excel |

## Importer (src/lib/importer)

1. **Read**: ExcelJS reads every named table with cached formula results, in the browser.
2. **Profile**: detects the 2026 layout (one `Account_*` table per account, month + week, category by name) or the 2027 layout (codes and "IC014 - Other Income" labels).
3. **Map**: category names resolve to codes through the `Category` lookup, tolerating small spelling differences ("Medecines"). Accounts are matched by name, then code. "Transfer / Start" rows become opening balances.
4. **Validate**: unknown months, missing amounts, unmapped categories and within-file duplicates are flagged. Duplicate budget months are detected: *Budget Oct␠* is set to August and is excluded in favour of *Budget Aug*.
5. **Reconcile**: per-account totals are compared with the workbook's own `Amount Lei`. All seven accounts in Budget 2026a match exactly.
6. **Pair transfers**: opposite amounts in different accounts in the same month (preferring the same week and a description naming the other account). 91 pairs in Budget 2026a.
7. **Commit**: one atomic local transaction tagged with an import batch. **Undo** removes everything that batch created. Re-importing skips rows already imported (source reference + amount), so the import is repeatable.
8. **Future plan mode** (budget 2027): rows become planned entries, kept apart from actual transactions. Budgets and yearly items are imported for 2027.

Skipped on purpose: stock trades, funds and portfolio sheets (out of scope); Total_* tables (recalculated).

## Sync protocol (src/lib/sync/sync.ts)

- Every local change is written together with an **op** (stable `opId`) into the `pending` table, in one IndexedDB transaction.
- Sync: download the snapshot and its **ETag**. If it changed since our last sync, load it and **replay our pending ops** on top. Ops whose IDs are already in the snapshot's `appliedOps` are dropped; this makes retries after an uncertain upload idempotent.
- Upload with **If-Match: <etag>** (or If-None-Match: * for the first save). On **412** the loop reloads and replays, up to 4 attempts. Ops are removed from `pending` only after a confirmed save.
- Local edits to records that the other person also changed since our last sync are listed in **Review overlapping changes** (keep mine / keep theirs).
- Transient errors and 429/5xx are retried with exponential backoff, honouring Retry-After.
- After a successful save, a dated backup is written at most daily, and the Excel reports are rebuilt and uploaded. If publishing fails, the previous report stays and publishing is retried on the next sync. The app shows the last sync time and the report revision.
- A closed or suspended app cannot sync in the background. Sync runs on open, when the app returns to the foreground, when the device comes back online, and a few seconds after each edit.

Tests in `tests/sync.test.ts` simulate a partner saving in between, an upload that succeeds but reports failure, and an overlapping edit.

## Security

- AES-256-GCM (authenticated) for the snapshot and backups, with gzip before encryption. The key ID is bound as additional data.
- A random data key is wrapped by PBKDF2-SHA256 (600k iterations) from the household passphrase, and separately from a one-time recovery code (`Data/keyring.json`).
- On each device the unwrapped key is stored as a **non-extractable** CryptoKey in IndexedDB. Script on the page can use it, but cannot read the raw bytes out.
- **Change passphrase** re-wraps the key. **Rotate key** creates a new data key, a new passphrase and a new recovery code, and re-encrypts the snapshot. Old keys stay in the keyring, wrapped by the new key, so old backups still open. Use rotation after removing someone's access. Copies already downloaded cannot be recalled.
- Named sharing only (`invite` with requireSignIn), plus an access list with revoke.
- Excel reports are **readable** by design. They contain names, categories and amounts, but no account numbers (none are stored). Keep the Reports folder shared only with the two of you.
- Nothing financial is logged. Errors show Graph messages only.

### Known gaps to decide before release
- The **local** IndexedDB cache on each device is not encrypted at rest; it relies on device and browser-profile security. Encrypting it would mean a passphrase prompt at every app start. Decide whether you want that.
- `Files.ReadWrite.All` is broader than `Files.ReadWrite`. It is required for the partner to open a shared folder. The owner could run with the narrower scope; a two-registration setup is possible if wanted.

## Release gates still open (from the brief)

These require your two real Microsoft accounts and devices; see SETUP.md §6 for the script:
1. Stale-write rejection on the exact consumer write path (built-in test provided).
2. Overlapping uploads, interrupted uploads, access removal, backup restore.
3. Excel PivotTable/Power Query refresh on Windows, Mac, web and iPhone, and deciding which clients need report authoring.
4. Graph's Excel workbook session API does not support personal accounts, so reports are generated in the browser (ExcelJS) and replaced whole. The library cannot write PivotTables or slicers; the published workbooks provide structured Tables as their source instead.
5. Storage limits: the household snapshot is about 0.5 MB per year of transactions (gzip makes it smaller), far below OneDrive and browser limits.

## Visual design and readability

- **Group colours.** Each category group has one colour (Income green, Planned costs blue, Reservations amber, Unplanned costs purple, Yearly expenses teal, Paid from reserves slate), defined in `src/components/Group.tsx`. It appears as a small marker next to a group or category name and as the tint of group headers; the name is always shown too, so colour is never the only cue. Text never takes the group colour.
- **Budget.** One card per group with its totals and a progress bar in the header (click to collapse), section rows with subtotals, and one line per row. Editable amounts sit in lightly filled fields; the figure that matters most (Remaining) is the only bold number; zeros are replaced by a quiet dash, "done" or "closed". Week lines for a week the month does not have stay hidden while empty.
- **Lists.** Transactions get one heading per day (with budget month and week) instead of a date on every row, and a category marker per row. Wide month grids keep the first column in view and shade alternate rows.
- **Phones.** Budget lines and transactions turn into stacked rows with small labels; extra transaction filters sit behind "More filters".
- **Contrast and size.** Secondary text is #5B6772 (above 4.5:1 on white and on the page background); the smallest text is 11.5px for codes, 12.5px for meta lines; touch targets are at least 44px on lists.
