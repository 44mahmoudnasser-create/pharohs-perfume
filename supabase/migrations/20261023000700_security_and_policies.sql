-- ════════════════════════════════════════════════════════════════════════════
-- 0700 — Security: privileges + Row Level Security
--
-- Principles
--   • anon (not signed in) gets nothing.
--   • Every policy checks the role stored in app_users (active users only),
--     never a role claim from the JWT or user_metadata.
--   • Ledger & sales tables have NO client write privileges at all; they are
--     written only by SECURITY DEFINER functions that validate the caller.
--
-- Permission matrix
--   table / action                               admin  manager  seller
--   app_users (read all / update)                 ✔       –        –   (everyone reads own row)
--   app_settings (update)                         ✔       –        –
--   audit_log (read)                              ✔       ✔        –
--   categories, products (insert / update)        ✔       ✔        –
--   inventory_items (insert / update)             ✔       ✔        –
--   inventory receive / adjust / count (RPC)      ✔       ✔        –
--   inventory_movements (read)                    ✔       ✔        –
--   bottle_sizes, oil_types, consumption rules,
--   extra components (write)                      ✔       –        –
--   perfume_prices, product restrictions (write)  ✔       ✔        –
--   sales_create_sale (RPC)                       ✔       ✔        ✔
--   sales (read)                                  all     all      own
--   sales_cancel_sale (RPC)                       ✔       ✔        –
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Table privileges ───────────────────────────────────────────────────────
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
revoke all on all sequences in schema public from anon;

grant select on all tables in schema public to authenticated;

grant update (full_name, role, active) on public.app_users to authenticated;
grant insert, update (value, description) on public.app_settings to authenticated;
grant insert, update on public.categories, public.products, public.inventory_items,
                       public.bottle_sizes, public.oil_types to authenticated;
grant insert, update, delete on public.oil_consumption_rules, public.perfume_prices,
                               public.perfume_product_bottle_sizes, public.perfume_product_oil_types,
                               public.perfume_extra_components to authenticated;
-- inventory_balances, inventory_movements, sales, sale_lines, sale_line_components,
-- perfume_sale_line_details, audit_log: SELECT only (writes via functions/triggers).

-- Display names only (no role / email / status), so sales lists can show who
-- sold what. Runs with the owner's rights but returns rows only to active users.
create view public.user_directory as
select u.id, coalesce(nullif(btrim(u.full_name), ''), split_part(u.email, '@', 1)) as display_name
from public.app_users u
where public.is_active_user();

revoke all on public.user_directory from anon, authenticated;
grant select on public.user_directory to authenticated;

-- ─── Function privileges ────────────────────────────────────────────────────
alter default privileges in schema public revoke execute on functions from public;
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.current_app_role(),
  public.has_any_role(text[]),
  public.is_active_user(),
  public.setting_bool(text, boolean),
  public.setting_text(text, text),
  public.shop_date(timestamptz),
  public.inventory_receive(bigint, numeric, text),
  public.inventory_adjust(bigint, numeric, text, text),
  public.inventory_record_count(bigint, numeric, text),
  public.perfume_sale_options(bigint),
  public.perfume_set_product_restrictions(bigint, bigint[], bigint[]),
  public.sales_create_sale(uuid, jsonb, text, text),
  public.sales_cancel_sale(bigint, text),
  public.report_sales_by(date, date, text),
  public.report_stock_consumption(date, date, text),
  public.dashboard_summary()
to authenticated;

-- ─── Row Level Security ─────────────────────────────────────────────────────
alter table public.app_users                    enable row level security;
alter table public.app_settings                 enable row level security;
alter table public.audit_log                    enable row level security;
alter table public.inventory_items              enable row level security;
alter table public.inventory_balances           enable row level security;
alter table public.inventory_movements          enable row level security;
alter table public.categories                   enable row level security;
alter table public.products                     enable row level security;
alter table public.bottle_sizes                 enable row level security;
alter table public.oil_types                    enable row level security;
alter table public.oil_consumption_rules        enable row level security;
alter table public.perfume_prices               enable row level security;
alter table public.perfume_product_bottle_sizes enable row level security;
alter table public.perfume_product_oil_types    enable row level security;
alter table public.perfume_extra_components     enable row level security;
alter table public.sales                        enable row level security;
alter table public.sale_lines                   enable row level security;
alter table public.sale_line_components         enable row level security;
alter table public.perfume_sale_line_details    enable row level security;

-- app_users
create policy app_users_select on public.app_users for select to authenticated
  using (id = (select auth.uid()) or (select public.has_any_role('admin')));
create policy app_users_update on public.app_users for update to authenticated
  using ((select public.has_any_role('admin')))
  with check ((select public.has_any_role('admin')));

-- app_settings
create policy app_settings_select on public.app_settings for select to authenticated
  using ((select public.is_active_user()));
create policy app_settings_insert on public.app_settings for insert to authenticated
  with check ((select public.has_any_role('admin')));
create policy app_settings_update on public.app_settings for update to authenticated
  using ((select public.has_any_role('admin')))
  with check ((select public.has_any_role('admin')));

-- audit_log
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.has_any_role('admin', 'manager')));

-- Read access for every active user on catalog / config / stock balances
create policy inventory_items_select on public.inventory_items for select to authenticated
  using ((select public.is_active_user()));
create policy inventory_balances_select on public.inventory_balances for select to authenticated
  using ((select public.is_active_user()));
create policy categories_select on public.categories for select to authenticated
  using ((select public.is_active_user()));
create policy products_select on public.products for select to authenticated
  using ((select public.is_active_user()));
create policy bottle_sizes_select on public.bottle_sizes for select to authenticated
  using ((select public.is_active_user()));
create policy oil_types_select on public.oil_types for select to authenticated
  using ((select public.is_active_user()));
create policy oil_consumption_rules_select on public.oil_consumption_rules for select to authenticated
  using ((select public.is_active_user()));
create policy perfume_prices_select on public.perfume_prices for select to authenticated
  using ((select public.is_active_user()));
create policy perfume_product_bottle_sizes_select on public.perfume_product_bottle_sizes for select to authenticated
  using ((select public.is_active_user()));
create policy perfume_product_oil_types_select on public.perfume_product_oil_types for select to authenticated
  using ((select public.is_active_user()));
create policy perfume_extra_components_select on public.perfume_extra_components for select to authenticated
  using ((select public.is_active_user()));

-- Movement history: admin / manager
create policy inventory_movements_select on public.inventory_movements for select to authenticated
  using ((select public.has_any_role('admin', 'manager')));

-- Catalog & inventory master data: admin / manager
create policy categories_insert on public.categories for insert to authenticated
  with check ((select public.has_any_role('admin', 'manager')));
create policy categories_update on public.categories for update to authenticated
  using ((select public.has_any_role('admin', 'manager')))
  with check ((select public.has_any_role('admin', 'manager')));
create policy products_insert on public.products for insert to authenticated
  with check ((select public.has_any_role('admin', 'manager')));
create policy products_update on public.products for update to authenticated
  using ((select public.has_any_role('admin', 'manager')))
  with check ((select public.has_any_role('admin', 'manager')));
create policy inventory_items_insert on public.inventory_items for insert to authenticated
  with check ((select public.has_any_role('admin', 'manager')));
create policy inventory_items_update on public.inventory_items for update to authenticated
  using ((select public.has_any_role('admin', 'manager')))
  with check ((select public.has_any_role('admin', 'manager')));

-- Perfume configuration: admin only
create policy bottle_sizes_insert on public.bottle_sizes for insert to authenticated
  with check ((select public.has_any_role('admin')));
create policy bottle_sizes_update on public.bottle_sizes for update to authenticated
  using ((select public.has_any_role('admin'))) with check ((select public.has_any_role('admin')));
create policy oil_types_insert on public.oil_types for insert to authenticated
  with check ((select public.has_any_role('admin')));
create policy oil_types_update on public.oil_types for update to authenticated
  using ((select public.has_any_role('admin'))) with check ((select public.has_any_role('admin')));
create policy oil_consumption_rules_write on public.oil_consumption_rules for all to authenticated
  using ((select public.has_any_role('admin'))) with check ((select public.has_any_role('admin')));
create policy perfume_extra_components_write on public.perfume_extra_components for all to authenticated
  using ((select public.has_any_role('admin'))) with check ((select public.has_any_role('admin')));

-- Prices & per-product restrictions: admin / manager
create policy perfume_prices_write on public.perfume_prices for all to authenticated
  using ((select public.has_any_role('admin', 'manager')))
  with check ((select public.has_any_role('admin', 'manager')));
create policy perfume_product_bottle_sizes_write on public.perfume_product_bottle_sizes for all to authenticated
  using ((select public.has_any_role('admin', 'manager')))
  with check ((select public.has_any_role('admin', 'manager')));
create policy perfume_product_oil_types_write on public.perfume_product_oil_types for all to authenticated
  using ((select public.has_any_role('admin', 'manager')))
  with check ((select public.has_any_role('admin', 'manager')));

-- Sales: admin / manager see all, sellers see their own
create policy sales_select on public.sales for select to authenticated
  using ((select public.has_any_role('admin', 'manager'))
         or (created_by = (select auth.uid()) and (select public.is_active_user())));
create policy sale_lines_select on public.sale_lines for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));
create policy sale_line_components_select on public.sale_line_components for select to authenticated
  using (exists (select 1 from public.sale_lines l where l.id = sale_line_id));
create policy perfume_sale_line_details_select on public.perfume_sale_line_details for select to authenticated
  using (exists (select 1 from public.sale_lines l where l.id = sale_line_id));
