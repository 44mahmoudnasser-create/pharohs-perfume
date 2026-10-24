# عطور الفراعنة — Perfume Shop Management System

Arabic (RTL) management system for a perfume shop: catalog, perfume formulations
sold by bottle size and oil type, ledger-based inventory, atomic sales, and reports.
It reuses the visual language of the Electro George factory system: same colors,
Cairo font, sidebar/drawer, cards, tables, `eg-*` classes, and the same Arabic RTL layout.

- **Frontend:** React 18, TypeScript, Vite and Tailwind. It's a static build, deployable to GitHub Pages.
- **Backend:** Supabase (PostgreSQL, Auth, PostgREST). All business rules live in the
  database (constraints, RLS, and transactional functions).

---

## 1. Architecture

```
src/
  core/               A — reusable business core (no shop-specific knowledge)
    auth/             AuthProvider (role from app_users), login, guards, change password
    layout/           AppShell: sidebar + mobile drawer
    ui/               DataTable, Pagination, Modal, ConfirmDialog, Form fields, KPI card,
                      badges, loading/empty/error states, notifications
    hooks/useAsync    loading / error / reload for every data call
    lib/              Supabase client, Arabic error mapping, formatting, CSV export
    settings/         app_settings provider
  modules/            B — reusable business modules
    catalog/          categories + products (one shared product model)
    inventory/        stock balances, receipts, adjustments, stocktake, movement ledger
    sales/            sales engine UI, cart, sale-mode registry, sale history, cancellation
    reports/          sales / consumption / stock reports
    dashboard/ settings/
  perfume/            C — perfume-specific module
                      bottle sizes, oil types, consumption rules, prices, per-product
                      restrictions, and the perfume sale-line editor
  app/                composition: permissions per role, navigation
  App.tsx             wires A + B + C together
supabase/
  migrations/         ordered SQL (source of truth for the schema)
  seed.sql            development-only demo data
  tests/              database test suite (real PostgreSQL 17)
```

**How the perfume module plugs into the generic sales module.** A product has a `sale_mode`.
The sales module keeps a registry of modes (`SaleModeDefinition`): each mode supplies a line editor
for the sales screen and, optionally, extra fields for the product form. In the database,
`sales_create_sale()` dispatches each line to the resolver for its mode:

| sale_mode | Customer sees | Stock consumed |
|---|---|---|
| `stock_item` | ready-made product at a fixed price | 1 unit of its linked inventory item |
| `perfume_formulation` | e.g. "عطر بلو" + size + oil type | oil (grams, from the rule) + 1 empty bottle of that size (+ optional extra components) |

To add a new kind of product later, add a resolver branch in the database and a line editor in the
UI. No new tables are needed per category.

### Data model (main tables)

| Area | Tables |
|---|---|
| Core | `app_users`, `app_settings`, `audit_log` |
| Inventory | `inventory_items`, `inventory_movements` (append-only ledger), `inventory_balances` (maintained only by the ledger trigger) |
| Catalog | `categories`, `products` |
| Perfume | `bottle_sizes`, `oil_types`, `oil_consumption_rules`, `perfume_prices`, `perfume_product_bottle_sizes`, `perfume_product_oil_types`, `perfume_extra_components` |
| Sales | `sales`, `sale_lines`, `sale_line_components`, `perfume_sale_line_details` |

Key business rules enforced in the database:

- **Oil is stocked in grams**, because consumption rules are grams per bottle. Bottles are stocked in pieces.
  Grams and millilitres are never treated as interchangeable.
- **Each bottle size and oil type automatically gets its own inventory item** (pcs / g) through a trigger.
  Adding one never needs a schema change.
- **Consumption rules** are unique per (oil type, bottle size) and must be greater than 0. A missing rule
  means the combination *cannot be sold*. It is never treated as zero.
- **Prices:** a default price per (size, oil), with an optional per-product override. A missing price
  blocks the sale.
- **Stock changes only through the ledger.** Movements cannot be updated or deleted, and balances are
  read-only for clients.
- **Sales:** `sales_create_sale(idempotency_key, lines)` validates every line, locks balance rows
  in item-id order (`SELECT … FOR UPDATE`), rejects the sale if any stock is short, then writes the sale,
  lines, rule snapshots, components and ledger movements in **one transaction**.
  - The same idempotency key returns the original sale (`duplicate: true`), so double-clicks and
    network retries never deduct twice.
  - Each line stores the grams-per-bottle actually used, so editing a rule later never changes history.
- **Cancellation** (`sales_cancel_sale`) adds reversal movements equal to the original deductions
  and marks the sale cancelled. Nothing is deleted.
- **Negative stock** is rejected unless an admin enables `inventory.allow_negative_stock`.

### Roles and security

| Permission | admin | manager | seller |
|---|:-:|:-:|:-:|
| Sell | ✔ | ✔ | ✔ |
| See all sales / cancel sales | ✔ | ✔ | own sales only / – |
| Manage categories & products | ✔ | ✔ | – |
| Stock receipts, adjustments, stocktake, movement history | ✔ | ✔ | – |
| Edit prices & per-product restrictions | ✔ | ✔ | – |
| Edit bottle sizes, oil types, consumption rules | ✔ | – | – |
| Reports | ✔ | ✔ | – |
| Settings & users | ✔ | – | – |

- The role is read from `app_users` (database), **never** from JWT or user metadata.
- New sign-ups are created **inactive**. An inactive user can read and do nothing.
- `anon` has no table or function privileges at all.
- Ledger and sales tables have no client write privileges. They are written only by
  `SECURITY DEFINER` functions with `search_path = ''` and fully qualified names, which check
  the caller's role first.
- The last active admin cannot be demoted or deactivated.
- The browser only ever receives the public anon/publishable key.

---

## 2. Database setup (your Supabase project)

### Migration order

Apply the files in `supabase/migrations/` **in filename order**. Each depends on the previous ones.

| # | File | Creates |
|---|---|---|
| 1 | `20261023000100_core_foundation.sql` | users/roles, settings (+ production defaults), audit log, helpers |
| 2 | `20261023000200_inventory.sql` | inventory items, ledger, balances, receive/adjust/stocktake RPCs |
| 3 | `20261023000300_product_catalog.sql` | categories, products |
| 4 | `20261023000400_perfume_configuration.sql` | sizes, oil types, rules, prices, restrictions, extra components, resolver, sale options |
| 5 | `20261023000500_sales_and_stock_transactions.sql` | sales tables, `sales_create_sale`, `sales_cancel_sale` |
| 6 | `20261023000600_reporting.sql` | stock view, sales report view, report functions, dashboard summary |
| 7 | `20261023000700_security_and_policies.sql` | privileges, RLS on every table, user directory view |

`seed.sql` contains **demo data for development only**. Do not run it on production.

### Option A — Supabase CLI (recommended)

```bash
npx supabase login
```
```bash
npx supabase link --project-ref YOUR-PROJECT-REF
```
```bash
npx supabase db push
```

`db push` applies only migrations that haven't been applied yet and records them in
`supabase_migrations.schema_migrations`. It does not run `seed.sql`.

### Option B — SQL Editor

Open Supabase Dashboard → SQL Editor and run each migration file's full contents, one at a time,
in the order above. (If you later switch to the CLI, run `supabase migration repair --status applied <version>`
for each file so the CLI knows they were applied.)

### Create the first admin

1. Supabase Dashboard → Authentication → Users → **Add user** (email + password, "Auto confirm").
2. SQL Editor:

```sql
update public.app_users
set role = 'admin', active = true, full_name = 'اسم المدير'
where email = 'you@example.com';
```

After that, add and activate other users from the app: **الإعدادات → المستخدمون والصلاحيات**.
Recommended: Authentication → Providers → Email → **disable "Allow new users to sign up"**, and create
accounts yourself from the dashboard.

### Auth URL configuration

Authentication → URL Configuration:
- **Site URL:** `https://<github-user>.github.io/<repo>/`
- **Redirect URLs:** add the same URL and `http://localhost:5173`

---

## 3. Local development

Requirements: Node 20+.

```bash
npm install
```

Create `.env.local` from `.env.example`:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-OR-PUBLISHABLE-KEY
```

```bash
npm run dev
```

Open http://localhost:5173.

### Fully local Supabase (optional, needs Docker)

```bash
npx supabase start
```
```bash
npx supabase db reset
```

`db reset` recreates the local database from all migrations and then runs `seed.sql`.
Use the local API URL and anon key printed by `supabase start` in `.env.local`. Create a user in
local Studio (http://localhost:54323) and promote it with the SQL above.

### Changing the schema later

```bash
npx supabase migration new describe_the_change
```

Write the SQL in the new file (never edit an already-applied migration), test locally with
`supabase db reset` and `npm run db:test`, then `supabase db push`.

---

## 4. Verification

| Command | What it checks |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (strict) |
| `npm run build` | production build |
| `npm run db:test` | applies all migrations + seed to a throwaway local **PostgreSQL 17** and runs 34 tests |

The database suite downloads an embedded PostgreSQL through npm (no Docker needed). It emulates only the
Supabase pieces it needs (`auth.users`, `auth.uid()`, the `anon` / `authenticated` roles and default
grants). It covers:

- the exact deduction (1 bottle = configured grams + 1 bottle) and multi-line sales
- missing rule, missing price and size restrictions
- insufficient stock with **no partial writes**
- idempotent retries, including two concurrent submissions with the same key
- **two concurrent connections** competing for the last bottles (no oversell)
- historical snapshots after a rule change
- cancellation reversals, and ledger/sale immutability
- RLS for anon, inactive, seller and manager users
- stocktake, the negative-stock setting, ledger = balance consistency
- consistency of the reports

---

## 5. Deployment

### Option A — Vercel

`vercel.json` already sets the Vite build (`npm run build` → `dist`), long-term caching for hashed
assets, and basic security headers.

1. Sign in at vercel.com with GitHub → **Add New… → Project** → import this repository.
2. Keep the detected settings (Framework: Vite, Root Directory: `./`).
3. **Environment Variables** (Production and Preview):
   - `VITE_SUPABASE_URL` = `https://YOUR-PROJECT-REF.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = your anon / publishable key
   - do **not** set `VITE_BASE_PATH` (Vercel serves from `/`)
4. **Deploy.** Every push to `main` then redeploys production, and every pull request gets a preview URL.
5. In Supabase → Authentication → URL Configuration, set **Site URL** to your Vercel URL
   (e.g. `https://pharohs-perfume.vercel.app`) and add it to **Redirect URLs**.

`VITE_*` variables are baked in at build time. After changing them in Vercel, **redeploy** so they take effect.

### Option B — GitHub Pages

1. Push this folder to a GitHub repository (branch `main`).
2. Repository **Settings → Pages → Source: GitHub Actions**.
3. Repository **Settings → Secrets and variables → Actions → Variables** → add:
   - `VITE_SUPABASE_URL` = `https://YOUR-PROJECT-REF.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = your anon / publishable key
4. Push to `main` (or run the "Deploy to GitHub Pages" workflow manually).

The site is published at `https://<github-user>.github.io/<repo>/`. The workflow sets
`VITE_BASE_PATH=/<repo>/` automatically. The app uses hash routes (`#/sales`), so page refreshes and
deep links work on GitHub Pages without server rewrites.

**Never** put the `service_role` key or the database password in GitHub variables, `.env*` files,
or any `VITE_*` variable. Anything prefixed `VITE_` ends up in the public JavaScript.

`.github/workflows/ci.yml` runs lint, typecheck and the database tests on pull requests.

---

## 6. Features implemented

- Login (same look as the factory system), change password, pending-activation screen, role-aware navigation
- Dashboard: today's sales, revenue and bottles, low stock, missing-configuration alerts, recent sales
- Categories: create, edit, activate/deactivate, product counts, search and status filter
- Products: shared model, category, SKU, description, image URL, sale mode, price (ready-made
  products), activate/deactivate, filters; per-product allowed sizes and oils for formulations
- Bottle sizes and oil types: CRUD, activation, linked stock, rule coverage per size and per oil
- Consumption rules matrix (oil × size) with missing rules highlighted; price matrix with default
  prices and per-product overrides
- New sale: category → product → size → oil → quantity, live availability and price, cart, one-click
  atomic checkout with idempotency, clear Arabic errors for missing configuration or insufficient stock
- Sales history with date and status filters, sale detail showing exactly what stock was deducted,
  and cancellation with a reason
- Inventory: book balances, low-stock flags, receipt, adjustment and waste with a reason, physical
  stocktake, new inventory items, paginated movement history with filters
- Reports (CSV export): sales by day, product, category, bottle size and oil type; oil and bottle
  consumption by period; current oil and bottle stock. Movement history is in Inventory → سجل الحركات
- Settings: shop name, currency, timezone, negative-stock and price-override policies; user role
  and activation management; audit log of configuration changes

## 7. Known limitations / next steps

- **No partial returns yet.** Only whole-sale cancellation exists. The ledger and reversal links
  support adding line-level returns later.
- **Product images are URLs.** There is no Supabase Storage upload yet.
- **Extra recipe components** (e.g. alcohol per bottle) are supported by the database and sales engine
  (`perfume_extra_components`), but there is no admin screen for them yet. Rows can be added in SQL.
- **Oil is stocked per oil type**, not per scent. If each scent needs its own oil stock, link the
  formulation to its own oil item through `perfume_extra_components` or a new resolver rule.
- **The cart's stock hint is approximate** when the same oil appears in several cart lines with
  different sizes. The database still validates the exact total at checkout.
- **No offline mode / PWA**, and no receipt printing.
- **Not tested against a hosted Supabase project.** The SQL was tested against plain PostgreSQL 17
  with emulated Supabase auth. Applying it to your project is the first real deployment.

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| "إعداد الاتصال بـ Supabase مطلوب" screen | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` missing at build time (`.env.local`, or the GitHub Actions variables) |
| "الحساب في انتظار التفعيل" after login | Activate the user and set a role (SQL above or Settings → Users) |
| Blank page on GitHub Pages | Pages source must be "GitHub Actions"; check the workflow log; the base path must match the repo name |
| "permission denied" / "ليس لديك صلاحية" | The user's role lacks that permission (see the roles table), or the user is inactive |
| Sale rejected "لا توجد قاعدة استهلاك…" | Add the rule in قواعد الاستهلاك والأسعار for that oil × size |
| Sale rejected "المخزون غير كافٍ…" | Record a receipt in المخزون, or (not recommended) enable negative stock |
| `db push` says a migration was already applied | You ran it in the SQL editor; use `supabase migration repair --status applied <version>` |
| Login works locally but not on Pages / Vercel | Add the deployed URL to Authentication → URL Configuration |
| Vercel site shows the "Supabase setup required" screen | The env vars were missing at build time: add them in Vercel → Settings → Environment Variables, then redeploy |
