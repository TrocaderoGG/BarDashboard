# QP Stock Room

A calmer, organization-only stock and ordering hub for Qlubbmästeriet. The three pages are **Stock overview**, **Trends & history**, and **Order requests**.

- Stock counts, confirmed deliveries, breakage, seven keg slots, two-opening forecasts and whole-pack supplier suggestions.
- Dated QP sales history from SumUp, with refunds, category filters and monthly totals. History does not silently deduct inventory.
- Member event requests with products, quantities, expected customers and servings per customer. The barmaster can approve, decline or ask for changes. Approval must link to a scheduled opening.
- Shared PostgreSQL records with row-level authorization. Members see their own requests; only the barmaster changes inventory or reviews orders.

## Local preview

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4173`. This **local-only preview** uses clearly marked sample stock and events. Edits disappear when the page reloads and are never submitted to an organization. If `private/sales.json` exists, its real, aggregated history is shown locally. Without it, history is empty. The production site never ships this preview dataset.

```sh
npm test
python -m unittest discover -s tests -p '*_test.py'
npm run build
```

`dist/` is the output for custom workflow deployments. It contains no stock, product catalog, sales records, request records, preview fixtures or raw CSV. The product catalog and planning rates load from the private database after sign-in.

The currently enabled branch-based GitHub Pages hosting uses the repository's root `index.html`, which loads the app from `site/`. `.nojekyll` keeps these static assets unchanged. The workflow reads the configured Pages source and only runs its own deployment when the source is **GitHub Actions**, preventing competing publishers. If you later connect the database through Actions variables, select **GitHub Actions** in Pages settings as described below. Branch-based hosting can instead use the public identifiers in `site/config.js`; no privileged key belongs there.

## GitHub Pages + private database

GitHub Pages hosts static files. It cannot authenticate organization members or save shared requests by itself. This implementation uses **Supabase Auth + PostgreSQL** as the authenticated data service. The public site is only a sign-in shell; all business data is protected by server-enforced membership checks, not a hidden route or a client-side password.

### Try it privately without SMTP

Password sign-in is the default and requires no email sender or organization rollout. After running the database scripts:

1. In Supabase **Authentication → Users → Add user → Create new user**, create a personal test account with an email and password and enable **Auto Confirm User** for this owner-created test account. Use an address you control. Public sign-ups can remain disabled. This account is separate from the account used to sign into the Supabase dashboard.
2. Add that exact lowercase address to `public.members` with role `admin` (the SQL example below applies). If it already exists in `members`, update its role rather than inserting it again. If an earlier invited Auth user has no password, create a separate test account instead of relying on the email password-reset flow.
3. Open the website and sign in with that test account's email and password. Do not share the password in chat or commit it. The browser exchanges it directly with Supabase Auth; only the resulting session tokens are retained per tab.

Private membership rules, stock writes and order approvals are unchanged. No email is sent during password sign-in. Email codes remain an optional mode for later; only that mode and email-based invitations/resets need email delivery. For a second-user test, manually create a second test account the same way and give it the `member` role.

### Full setup and optional email codes

1. Create a dedicated Supabase project. Run `supabase/schema.sql`, then `supabase/catalog.sql`, in its SQL editor. The schema is an initial migration for a **new project**; it deliberately restricts grants in the `public` schema. Do not run it in an unrelated existing application.
2. In **Authentication → Providers → Email**, enable email authentication and disable public sign-ups. Email/password testing does not require SMTP. If you later want email codes, configure the **Magic Link** email template to show `{{ .Token }}`, set the site URL to the Pages URL, and configure a production SMTP sender. Supabase's default sender is restricted and is not sufficient for arbitrary organization invitees. Neither sign-in mode requires GitHub accounts.
3. Create the barmaster and test members manually as described above, or invite them through **Authentication → Users** once email delivery is configured. Add their exact confirmed email addresses to `public.members`; only the barmaster receives `admin`. Example (replace the addresses):

   ```sql
   insert into public.members(email,role) values
     ('barmaster@example.org','admin'),
     ('organizer@example.org','member');
   ```

   This explicit allowlist does not assume everyone at `kth.se` or `ths.kth.se` belongs to QP. To revoke access, set `active=false`; authorization changes on the next server request even for existing login sessions. The browser cannot edit this allowlist or grant itself a role.
4. The public connection identifiers are configured in `site/config.js` for branch-based hosting. To override them in a workflow build, set both of these **GitHub repository Actions variables**, not privileged secrets, under **Settings → Secrets and variables → Actions → Variables**:
   - `SUPABASE_URL`: `https://<project-ref>.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY`: the `sb_publishable_…` key or legacy `anon` key. **Never use a service-role or secret key.**
5. In **Settings → Pages**, select **GitHub Actions** as the build source. This repository is public by the owner's choice. Source files and commit history are publicly readable; do not commit real inventory, requests, sales exports or database secrets. The hosted shell is publicly reachable even though database content is organization-only.
6. Run **Check and publish Stock Room**. Every successful push to `main` publishes through the configured Pages source. Workflow builds use the paired Actions variables when set, otherwise the public connection from `site/config.js`. Without either connection, the website displays the setup screen. Configuring a connection enables the sign-in form; the Supabase schema, membership list and email settings must also be ready for real sign-in and shared data.
7. Sign in as the barmaster, enter the first real counts, verify planning reserves and add actual upcoming openings. No real stock count or schedule has been invented. Test sign-in and an actual shared request from a second member before handing out the link.

The shared production setup needs these external account steps; none of them is falsely represented by the local preview.

## Import the supplied history

The uploaded file is a **dated transaction export**, different from the old product-total CSV. The importer reads quoted CSV fields, Swedish month names, comma decimals, nonbreaking-space thousands and Unicode refund minus signs. It sums **line** revenue once, without multiplying it by quantity.

```sh
python scripts/import_sales.py /path/to/forsaljningsrapport-2026-01-01_2026-10-03.csv \
  --from-date 2026-01-01 --to-date 2026-10-03
```

This writes `private/sales.json` for local review and `private/sales.sql` for the Supabase SQL editor. Both are ignored by Git and excluded from the static build. The raw export is never copied. Account emails, payment methods and transaction identifiers are discarded before aggregation.

The importer prints its reconciliation summary and stores verified totals in the ignored `private/` directory. Keep these business figures out of the public source repository. Earlier README revisions contained historical aggregate sales figures; removing them here does not remove them from Git history.

Included categories are QP, QP-NPR, QP-VPR, QP-Pitbull and QP-Plåt. A `QP` product-name prefix alone never overrides another chapter's explicit category. A blank-category refund is matched only when that exact product has one unambiguous category across the export. The import RPC is restricted to the database owner/service role; browser accounts cannot call it. Reimporting the same file is a no-op; overlapping date ranges are rejected to prevent duplicate revenue.

For future CSVs, pass the actual coverage dates. Do not infer completeness from the first/last transaction. For a future SumUp API job, create the same `{meta, rows}` payload behind a trusted scheduled service. Use a server-side credential and a non-overlapping confirmed coverage window. Never put SumUp or Supabase privileged keys into Pages files.

## Forecast rules and limits

- Stock = latest product count + later confirmed deliveries − later breakage − estimated demand from later, non-cancelled openings. No deductions from the same CSV are applied again.
- Demand is a product's normal opening rate × its opening multiplier. Where there are approved requests for that opening, the sum of approved quantities replaces the normal product estimate when larger. Members receive only the aggregate demand, not other organizers' names or notes.
- Suggestions cover the next two scheduled openings plus a reserve, rounded to full supplier packs and capped at storage capacity. Partial occupied keg slots still consume a slot. A capacity shortfall is shown instead of recommending a partial case or an over-capacity order.
- Opening coverage is expressed in **normal openings**, not calendar weeks. The dated shortfall follows the actual configured schedule. Unknown counts stay unknown, not zero. No calendar-date projection is fabricated for missing future openings.
- Seven 30 L keg slots: three chilled and four warm; 50 practical 50 cl servings per full keg. Chilling requires 48 elapsed hours, including over Stockholm daylight-saving changes. Saving keg slots creates a new tap-beer baseline. Keg-slot contents are a physical observation and need a new count after use; the aggregate stock estimate alone cannot know which keg was emptied.
- The initial soda variant split, Red Bull split and minimum reserves are assumptions from the earlier dashboard. Mixer use comes from planning rates; generic POS buttons cannot identify flavor, brand or cocktail recipes. Rates/pack metadata can be maintained in the private `products.definition` records; reserves are editable in the UI.
- The schedule is manually maintained here. Live Google Sheets, invoice ingestion and SumUp API synchronization are **not connected**. No invoice or supplier order adds stock until it is explicitly confirmed. Future enhancements belong behind the same authenticated data boundary.
- Email sign-in uses a per-tab session token. Application records are not saved in localStorage/sessionStorage. Failed submissions keep form input; stock and requests are only reported as saved after the service succeeds.

## Validation

Node tests exercise forecast calculations and run the real schema in an embedded PostgreSQL runtime. Permission tests cover anonymous users, signed-in outsiders, members, admins, private requests, role escalation, duplicate submission/delivery prevention, revocation and keg constraints. Python tests cover the CSV's localization and chapter/refund rules. `tests/browser_check.py` is an optional Playwright check of desktop/mobile form flows and the production lock screen; it requires Python Playwright and Chromium.

The optional `read_stock_forecast` WebMCP tool is feature-detected and reads the same authorized state as the UI. It cannot change stock or bypass sign-in. A native WebMCP-capable browser is required to validate registration; standard Chromium QA does not claim that validation.

## Private supplier purchase history

Run `supabase/purchases.sql` after the base schema to enable the purchase section in Trends & history. It is an additive, repeatable migration; authenticated active members can read purchases, while only the database owner/service role can import. Until migration, the existing dashboard remains usable and shows a setup notice. Unexpected database errors are not hidden.

The local receipt importer accepts a private JSON array of Drive PDF text records (`id`, `title`, `url`, `text`):

```sh
python scripts/import_receipts.py private/receipt-sources.json
```

Outputs in ignored `private/`: `purchases.json`, `purchases-review.json`, a review CSV, and `purchases-import.sql`. The last file bundles the migration and verified data for the Supabase SQL Editor. Never commit these outputs. The local preview reads the private purchases file; public builds contain no receipt data.

Ownership follows each delivery/order's customer reference, not the invoice customer name or product names. Valid QP-plus-date references (including a hyphen or event suffix) qualify. Missing/unusual references are held for review, and explicit other references are excluded. `--legacy-qp` additionally accepts plain QP, six/eight-digit date-before-QP references and QP slash-date references after the owner confirms that rule. Reference text is preserved; dates are taken from the printed delivery date rather than interpreted from these legacy references. Mixed invoices are split by order/delivery; unknown layouts and mismatched totals are held aside. Review output covers all source files, including excluded and unparsed records.

Purchase amounts exclude VAT and include printed packaging, returns and delivery charges. Martin & Servera can include deposits in product prices. Quantities preserve invoice units; unknown pack sizes stay unknown. Each included order's lines reconcile with its printed net total. Importing the same records twice is a no-op; conflicting records require reconciliation. Purchase history never changes stock, and does not establish that the folder contains every purchase. Delivery drafts, profit calculations, product price charts and automatic Google Drive synchronization are not implemented.
