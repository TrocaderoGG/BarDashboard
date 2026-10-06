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

1. Create a dedicated Supabase project. Run `supabase/schema.sql`, then `supabase/catalog.sql`, in its SQL editor. The schema is an initial migration for a **new project**; it deliberately restricts grants in the `public` schema. Do not run it in an unrelated existing application.
2. In **Authentication → Providers → Email**, enable email authentication and disable public sign-ups. Configure the **Magic Link** email template to show `{{ .Token }}` as the sign-in code. The site uses email + code, so members do not need GitHub accounts. Set the site URL and any requested allowed origins to the eventual Pages URL. Configure a production SMTP sender; Supabase's default sender is restricted and is not sufficient for arbitrary organization invitees.
3. Invite the barmaster and members through **Authentication → Users**. Add their exact verified email addresses to `public.members`; only the barmaster receives `admin`. Example (replace the addresses):

   ```sql
   insert into public.members(email,role) values
     ('barmaster@example.org','admin'),
     ('organizer@example.org','member');
   ```

   This explicit allowlist does not assume everyone at `kth.se` or `ths.kth.se` belongs to QP. To revoke access, set `active=false`; authorization changes on the next server request even for existing login sessions. The browser cannot edit this allowlist or grant itself a role.
4. Add these **GitHub repository Actions variables**, not privileged secrets, under **Settings → Secrets and variables → Actions → Variables**:
   - `SUPABASE_URL`: `https://<project-ref>.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY`: the `sb_publishable_…` key or legacy `anon` key. **Never use a service-role or secret key.**
5. In **Settings → Pages**, select **GitHub Actions** as the build source. This repository is public by the owner's choice. Source files and commit history are publicly readable; do not commit real inventory, requests, sales exports or database secrets. The hosted shell is publicly reachable even though database content is organization-only.
6. Run **Check and publish Stock Room**. Every successful push to `main` publishes the website. Without the database variables, it displays the setup screen and does not load organization data or accept requests. After the database is configured, rerun the workflow to publish the sign-in-enabled site. The workflow returns the real Pages URL after deployment.
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
