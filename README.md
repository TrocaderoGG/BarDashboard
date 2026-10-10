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

Purchase amounts exclude VAT and include printed packaging, returns and delivery charges. Martin & Servera can include deposits in product prices. Quantities preserve invoice units; unknown pack sizes stay unknown. Each included order's lines reconcile with its printed net total. Importing the same records twice is a no-op; conflicting records require reconciliation. Purchase history never changes stock, and does not establish that the folder contains every purchase. Profit calculations, product price charts and automatic Google Drive synchronization are not implemented.

## Flexible stock editor and phone counts

Run **`supabase/inventory.sql`** once in the Supabase SQL Editor after the base schema/catalog. It can be repeated safely. Existing product IDs and count history remain intact; no physical stock is seeded. The public site detects whether the upgrade is installed and explains setup if it is missing.

Barmasters open **Count stock**, tap a product from pinned staples, category tiles or search, and save its count immediately. **Product library** opens the separate management flow. Products have brand/type/flavour tags, container size, counting method, shelf order, staple/seasonal/occasional status and an optional replenishment switch. Confirmed pack sizes are: soda 33 cl = 20; Red Bull 25 cl = 24; Mariestad 50 cl = 15; Briska 33 cl cans/glass = 24; Smirnoff Ice 27.5 cl = 24. Add flavour copies packaging but resets usage/reserve assumptions. A different container size or stock unit requires a new variant, preserving old quantities and request meanings. Archive hides a product from active stock and new requests, and can be reversed.

Choose one product and count full packs plus loose units. A guided category count saves each product independently with Save & next; Skip leaves stock unchanged. For spirits, count full bottles and each opened bottle's remaining fraction (or ml). Stock stays in bottle equivalents; the UI also shows ml. Opened bottles are marked as estimates. The 30 L tap product retains the separate seven-slot keg workflow and practical 50-glass yield. Empty return crates should be added as separate **Other item** products; they never count as beverages.

Run **`supabase/counting.sql`** after `inventory.sql` and `product_tags.sql` to enable direct counts. It is additive and repeatable. **Save count** writes a product immediately, without a review/publish stage. **Out of stock** explicitly confirms zero; simply opening the counter records nothing. Completed products show a Counted today badge and move into count history. Unfinished single-product amounts autosave privately and require an explicit Continue or Discard choice. Older multi-product drafts remain reviewable, with Count again actions; saving a new physical count removes that product from the author's older unfinished drafts. Count saves are atomic and retry-safe, and reject stale stock versions after a delivery, breakage or another physical count. Product versions and draft revisions are also checked. Offline counts are not supported.

Members can view stock and request active products, but cannot edit products or drafts. Drafts are visible only to their author while they retain the admin role. Client estimates for spirit requests use 40 ml per serving; this is a planning conversion, not a consumption recommendation. Family-wide replenishment targets, offline drafts, barcodes and automatic recipe depletion are not implemented; planning rates/reserves are still per variant.

## Pub reservations and dated delivery planning

Run `supabase/planning.sql` after the base schema to enable explicit opening types. Existing events remain `legacy`, preserving previous max(estimate, reservations) behavior until reviewed. **Normal pub** adds expected regular usage to approved extra request quantities. **Event** uses approved requests only. Separate pub and event openings on the same date remain separate demands. Pending requests appear only as an approval preview, not committed stock.

The stock page plans eight weeks chronologically, protects pub use plus approved event reservations and a product reserve, and proposes whole-pack top-ups near the need date. Delivery proposals do not record stock movements or book supplier orders. Spendrups uses Tuesdays; Martin & Servera uses Tuesdays/Thursdays, with a per-preview preference. Both require ordering before the preceding Sunday at 23:59:59 Europe/Stockholm; daylight saving is accounted for. Missed cutoffs and unknown suppliers require manual resolution. Same-day arrivals need a confirmed time. Tap proposals allow 48 elapsed hours of chilling and require a separate slot/fridge check. Normal product capacity is a comfortable limit: projected temporary excess is shown instead of truncating the order. Keg slots remain a physical constraint.

For empirical normal-pub rates, explicitly mark past normal openings and map an exact till product label in the stock editor. Suggestions average QP-category units over unique covered reference dates (including zero-sale dates). Mapping one generic label to multiple variants disables those suggestions. The aggregate CSV cannot resolve overnight sessions or mixed events on a date; review suggestions and manually enter accepted rates. No rate is silently adopted, and sales are not automatically deducted from physical stock.

## Focused supplier orders and receiving

Run **`supabase/deliveries.sql`** after `schema.sql` and `inventory.sql` in the Supabase SQL Editor. This additive migration creates private barmaster-only supplier orders; it does not populate stock or import business data. Before migration, the new delivery screen shows setup guidance while the existing stock/count flows continue working.

**Record an order**: enter supplier, expected delivery date and QP/supplier reference, then search the library and add only ordered products. Tally full packs/crates/bottles/kegs plus loose units. Saved orders snapshot names, units, packaging and quantities, so later catalogue edits cannot reinterpret an existing order. This records an order already placed with the supplier; it does not send orders or enforce supplier cutoffs.

**Receive delivery**: select a saved order, tally each product actually received, and explicitly confirm each item, including zero for a missing product. Review compares quantities automatically. Missing or extra items require a note. Confirmation adds only received stock, records the comparison and closes the delivery atomically. A repeat click/retry cannot add stock twice. A later shipment needs its own order/reference. An unexpected product should be added to the expected list before receiving, or handled under a separate delivery reference. Receiving without a saved order uses the same product picker and tally, then confirms received amounts directly. These receipts explicitly say there is no saved order to compare.

Keg receipts fill available warm slots first, then free fridge slots begin chilling; the database rejects deliveries exceeding the seven empty slots. These receipts add practical glasses and update keg slots together. Existing stock without a physical baseline remains unknown until counted. Invoice purchase history remains separate from orders and stock movements.

The stock landing page starts with three tasks and category cards. Detailed reservations are expandable. Product creation shows brand, type, name, flavour and packaging first; organization and planning settings are expandable. Count drafts are stored in the existing private count-session table. Unsaved supplier-order and receiving tallies stay in the open dialog only; closing it discards those edits, and reopening a saved order starts a fresh receiving tally. Offline receiving, partial multi-shipment orders and supplier API integration are not implemented.

`npm test` includes embedded PostgreSQL receipt authorization, pack snapshot, conflict, missing/extra, keg capacity, atomic rollback and idempotency tests, plus focused event-handler flows. GitHub validation also runs `tests/focused_browser_check.py` across phone widths with fictional temporary preview data. Browser screenshots are validation artifacts, not deployed inventory data.

## Named products and tag-based library

Run **`supabase/product_tags.sql`** after `inventory.sql` (and `deliveries.sql` if already installed). Do not rerun the base schema or reseed an existing database. This additive, repeatable upgrade keeps historical IDs, counts and orders. Generic seed placeholders for 33 cl beer, unspecified cider, alcohol-free beer/cider, 50 cl soft drinks and unspecified sparkling wine are archived; their old quantities are never assigned to a newly named brand or flavour. Archived placeholders have a read-only history view with an action to create a separate named variant.

The active catalogue uses verified named products, including the user-confirmed Briska Mango can and Briska Demi Sec glass variants. New products have explicit **Brand**, **Product type**, **Flavour / variant**, optional **Product name** (defaults to brand plus flavour), **Container**, **Container size**, and **Units / pack** fields. The old brand-specific “Start from” presets are removed. A brand has one library facet; can versus glass is packaging, and each container size/unit remains a separate product identity. Alcohol-free is a cross-cutting tag, so it can coexist with Beer or Cider. Optional additional tags allow seasonal and other useful filters. Browse by type, brand, flavour or tags and combine filters. There is one stock room, so location controls are removed; historical count metadata is preserved internally.

The database rejects unnamed brands, generic seed names, duplicate active identities, duplicate supplier-specific codes and duplicate barcodes. Optional supplier product codes and barcodes are stored privately for future exact purchase matching. New packaging must be confirmed in the form. Guinness is verifiably present on receipts as a 44 cl can, but its legacy assumed pack size remains unverified: count individual units or explicitly confirm the pack size before recording packs. New count/order guards also enforce this on the server. A packaging change does not reinterpret a saved supplier order's snapshot.

**Popular named products** in Trends & history uses explicit labels in the sales export and net units after refunds. Generic cider/beer/soda buttons stay in the sales ledger and are not attributed to branded variants. Named brand labels can still lack flavour or serving size, which the UI explains. Neither sales nor old purchase receipts establish current stock. The private source-grounded product review is `private/product-review.md`; business totals and receipt SKUs remain excluded from the public repository.

## Wednesday and Friday pub insights

Trends & history defaults to the past 30 inclusive Stockholm dates, with a reset shortcut. The pub comparison uses QP sales only and completed dates. When covered historical openings are marked Normal pub with 1× usage, only those dates are compared, including zero-sale dates. Otherwise it compares observed QP trading dates and labels that limitation. Explicit event/cancelled dates are excluded. Typical demand is the median of recognized drink items per date; busiest is the observed maximum. Preparation detail retains the original till labels and never assigns generic sales to stock brands or changes orders. Daily totals cannot attribute after-midnight sales to the previous pub. Merchandise and transaction-line counts are not attendance. A workload calculator requires the worker's own drink-purchases-per-customer assumption, displays a scenario, and never invents a default customer estimate. No database migration is required.

The year graph is independent of the past-month filters and compares monthly arithmetic mean QP revenue or recognized drink items for Wednesdays and Fridays. Each point shows its sample count; expandable detail lists the exact dates. Its default uses observed QP trading dates; an explicit option uses only covered marked normal pubs, including genuine zero-sale dates. Missing months remain gaps. Annual averages divide total sales by all eligible dates, rather than averaging monthly means. Revenue includes food and merchandise; drink items are not attendance. No database migration is required.

The year graph uses thin solid teal/orange curves through the actual monthly averages. Curves are decorative and preserve gaps; they do not estimate intervening sales. Soft translucent ribbons show the observed minimum–maximum per-date totals for months with at least two dates. The ribbon edges are decorative interpolations, not confidence intervals or forecast limits. Ribbons stop at missing or single-date months; an isolated month with a range gets a small tapered patch. Single-date months carry an asterisk and limited-data label with no range. Tap or focus a point to inspect its average, sample count and individual date totals.
