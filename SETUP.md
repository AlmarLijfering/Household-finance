# Setting up sync, sharing and hosting

This takes about 20 minutes, once. Costs: none. GitHub Pages and the Microsoft app registration are free, and the app uses the OneDrive storage you already have.

## 1. Host the app (free, HTTPS)

The app is a static site, and any static host works. GitHub Pages is the simplest:

1. Create a **private or public** GitHub repository, e.g. `household-finance`, and push this folder to it. The `.gitignore` keeps `.xlsx` files and exports out of the repository, so your financial data is never committed.
2. In the repository: **Settings → Pages → Source: GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/pages.yml` runs the tests, builds and publishes to
   `https://<your-github-user>.github.io/household-finance/`.

Alternatives: Azure Static Web Apps (free tier) or Cloudflare Pages work the same way. Build command `npm run build`, output folder `dist`. Set `BASE_PATH=/` when the site is served from a domain root.

> GitHub Pages from a private repository needs a paid GitHub plan. A public repository is fine: it contains only code, never data.

## 2. Register the app with Microsoft (Entra ID)

1. Sign in at <https://entra.microsoft.com> with your **personal** Microsoft account (the one that owns OneDrive). If it asks you to create a tenant, accept the free default directory.
2. **App registrations → New registration**
   - Name: `Household Finance`
   - Supported account types: **Personal Microsoft accounts only**
   - Redirect URI: platform **Single-page application (SPA)**, URI = your app URL exactly, e.g. `https://almar.github.io/household-finance/`
   - Add `http://localhost:5173/` as a second SPA redirect URI if you want sync while running locally.
3. Copy the **Application (client) ID**.
4. **API permissions → Add → Microsoft Graph → Delegated**: `User.Read`, `Files.ReadWrite.All`. No admin consent is needed for personal accounts; each of you approves once at first sign-in.
   - `Files.ReadWrite.All` is needed because the partner who did *not* create the folder opens it as an item shared with them. Microsoft Graph only allows that with the `.All` scope.
5. No client secret: the app is a public client and uses PKCE.

Put the client ID into the app in one of two ways:
- **Settings → Sync & sharing → Microsoft app registration**, pasted once on each device, or
- as a repository variable `MSAL_CLIENT_ID` (Settings → Secrets and variables → Actions → Variables), so the build includes it.

## 3. First person: create the household

1. Open the app, import your workbook (or start fresh), then go to **Settings → Sync & sharing**.
2. **Sign in with Microsoft.**
3. **Create household folder**. This creates `OneDrive/Household Finance/` with `Data`, `Reports` and `Backups`.
4. **Choose a household passphrase** (12+ characters; a sentence works well). The app encrypts everything on this device and uploads it.
5. **Write down the recovery code** it shows. It is the only way back in if you both forget the passphrase.
6. **Invite your partner** by email with edit access (Who has access → Invite).

## 4. Second person: join

1. Accept the OneDrive invitation email.
2. Open the app → **Join our household on OneDrive** → sign in with *your own* Microsoft account.
3. **Find shared folders** → *Household Finance* → **Use this folder** (or paste the sharing link).
4. Enter the household passphrase. The household file becomes your data on this device.

## 5. Install on each device

- **iPhone / iPad (Safari):** Share → *Add to Home Screen*.
- **Windows / macOS (Edge or Chrome):** the install icon in the address bar.

## 6. Run the release checks before relying on shared edits

The brief asks for these to be proven with your two real accounts. The app has a built-in check, and the rest is a short manual script:

| # | Check | How |
|---|---|---|
| 1 | Stale writes are rejected | Settings → *Run stale-write test*, once from each account. It must report "rejected with 412". |
| 2 | Overlapping edits | Turn on airplane mode on device A. Edit the same transaction on A and B. Sync B, then bring A online. A must show *Review overlapping changes*, and the result must contain both sets of changes. |
| 3 | Two uploads at once | Add different transactions on A and B and press *Sync now* on both within a second. Both transactions must end up on both devices, with no duplicates. |
| 4 | Failed upload | Start a sync and kill the network mid-upload. After reconnecting, the transaction must appear exactly once. |
| 5 | Backup restore | Settings → Backups → Restore an older backup. Both devices show the restored data after their next sync. |
| 6 | Access removal | Remove the partner's access, rotate the key, confirm their app now asks for a passphrase and cannot open new data. |
| 7 | Interrupted report publishing | Close the app during *Publishing Excel reports…*. On reopen it must publish again; the previous report stays readable meanwhile. |
| 8 | Excel clients | Open `Reports/Household Reports.xlsx` in Excel for Windows, Mac, web and iPhone. Build a PivotTable from the `Transactions` table in your own workbook (see below) and confirm Refresh works after the next publish. |

## Your own PivotTables

The app overwrites `Household Reports.xlsx` and `Household Data.xlsx` after each sync. To keep custom analyses that survive updates:

1. Create your own workbook in the `Reports` folder, e.g. `My analysis.xlsx`.
2. **Data → Get Data → From File → From Workbook** → pick `Household Data.xlsx` → table `tblTransactions` (and/or `tblBudget`) → *Load to… PivotTable Report*.
3. Add slicers on `Year`, `Group` and `Account`, and group dates by month.
4. **Data → Refresh All** picks up the latest published data.

Power Query refresh works in Excel for Windows and Mac. Excel for the web and mobile can view and filter these PivotTables but cannot refresh external connections. Plan to author in desktop Excel; this is release-gate check 8.
