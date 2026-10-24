-- ════════════════════════════════════════════════════════════════════════════
-- 0800 — Access by category and day, deletions, sale mode per category
--   • categories.sale_mode: products inherit their sale mode from the category,
--     chosen once there instead of per product
--   • user_category_access: an admin decides which categories a seller may
--     see and sell in
--   • sellers see only today's invoices that contain a granted category, and
--     only the lines of granted categories
--   • deletes for catalog and configuration; anything sold or stock-moved stays
--     protected by RESTRICT foreign keys
--   • a new oil / bottle size is enabled automatically on products that restrict
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Sale mode belongs to the category ───────────────────────────────────
alter table public.categories
  add column sale_mode text not null default 'stock_item'
    check (sale_mode in ('stock_item', 'perfume_formulation'));

comment on column public.categories.sale_mode is
  'How every product in this category is sold. Set once here; products inherit it. Locked while the category has products.';

-- Keep existing data consistent with the products already in each category.
-- (A no-op on a fresh database.)
update public.categories c
   set sale_mode = p.sale_mode
  from (select distinct on (category_id) category_id, sale_mode
          from public.products
         order by category_id, id) p
 where p.category_id = c.id;

create or replace function public.categories_sale_mode_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sale_mode is distinct from old.sale_mode
     and exists (select 1 from public.products p where p.category_id = old.id) then
    raise exception 'لا يمكن تغيير طريقة البيع لتصنيف يحتوي على منتجات'
      using errcode = 'P0001', hint = 'CATEGORY_HAS_PRODUCTS';
  end if;
  return new;
end;
$$;

create trigger categories_sale_mode_guard
  before update of sale_mode on public.categories
  for each row execute function public.categories_sale_mode_guard();

create or replace function public.products_follow_category_mode()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mode text;
begin
  select c.sale_mode into v_mode from public.categories c where c.id = new.category_id;
  new.sale_mode := coalesce(v_mode, new.sale_mode);
  -- stock fields only make sense for ready-made products
  if new.sale_mode <> 'stock_item' then
    new.inventory_item_id := null;
    new.unit_price := null;
  end if;
  return new;
end;
$$;

create trigger products_follow_category_mode
  before insert or update of category_id, sale_mode on public.products
  for each row execute function public.products_follow_category_mode();

-- ─── 2. Deletes ─────────────────────────────────────────────────────────────
-- Pure configuration (rules and prices) goes away with its parent. Anything a
-- sale or the ledger refers to stays RESTRICTed, so it can't be deleted.
alter table public.oil_consumption_rules
  drop constraint oil_consumption_rules_oil_type_id_fkey,
  add constraint oil_consumption_rules_oil_type_id_fkey
    foreign key (oil_type_id) references public.oil_types (id) on delete cascade,
  drop constraint oil_consumption_rules_bottle_size_id_fkey,
  add constraint oil_consumption_rules_bottle_size_id_fkey
    foreign key (bottle_size_id) references public.bottle_sizes (id) on delete cascade;

alter table public.perfume_prices
  drop constraint perfume_prices_oil_type_id_fkey,
  add constraint perfume_prices_oil_type_id_fkey
    foreign key (oil_type_id) references public.oil_types (id) on delete cascade,
  drop constraint perfume_prices_bottle_size_id_fkey,
  add constraint perfume_prices_bottle_size_id_fkey
    foreign key (bottle_size_id) references public.bottle_sizes (id) on delete cascade;

-- A bottle size / oil type owns its stock item. Deleting it also deletes that
-- item; if the item has ledger movements the delete is refused, and the whole
-- statement rolls back.
create or replace function public.perfume_drop_backing_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.inventory_items where id = old.inventory_item_id;
  return old;
end;
$$;

create trigger bottle_sizes_drop_backing_item
  after delete on public.bottle_sizes
  for each row execute function public.perfume_drop_backing_item();

create trigger oil_types_drop_backing_item
  after delete on public.oil_types
  for each row execute function public.perfume_drop_backing_item();

grant delete on public.categories, public.products, public.inventory_items,
                public.bottle_sizes, public.oil_types to authenticated;

create policy categories_delete on public.categories for delete to authenticated
  using ((select public.has_any_role('admin', 'manager')));
create policy products_delete on public.products for delete to authenticated
  using ((select public.has_any_role('admin', 'manager')));
create policy inventory_items_delete on public.inventory_items for delete to authenticated
  using ((select public.has_any_role('admin', 'manager')));
create policy bottle_sizes_delete on public.bottle_sizes for delete to authenticated
  using ((select public.has_any_role('admin')));
create policy oil_types_delete on public.oil_types for delete to authenticated
  using ((select public.has_any_role('admin')));

-- ─── 3. Category access per seller ──────────────────────────────────────────
create table public.user_category_access (
  user_id      uuid not null references public.app_users (id) on delete cascade,
  category_id  bigint not null references public.categories (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, category_id)
);

comment on table public.user_category_access is
  'Categories a seller may see and sell in. Admins and managers are not limited by this table. Written only by set_user_category_access().';

create index user_category_access_category_idx on public.user_category_access (category_id);

create trigger user_category_access_audit
  after insert or delete on public.user_category_access
  for each row execute function public.audit_row_change('user_id');

alter table public.user_category_access enable row level security;
grant select on public.user_category_access to authenticated;

create policy user_category_access_select on public.user_category_access for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_any_role('admin')));

-- Admin / manager: every category. Seller: only granted ones. Everyone else: none.
create or replace function public.can_access_category(p_category_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.current_app_role() in ('admin', 'manager') then true
    when public.current_app_role() = 'seller' then exists (
      select 1 from public.user_category_access a
      where a.user_id = auth.uid() and a.category_id = p_category_id)
    else false
  end
$$;

-- A sale is visible to a seller when it is from today and contains at least
-- one granted line. Admins and managers see every sale.
create or replace function public.sale_is_visible(p_sale_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.current_app_role() in ('admin', 'manager') then exists (
      select 1 from public.sales s where s.id = p_sale_id)
    when public.current_app_role() = 'seller' then exists (
      select 1
      from public.sales s
      join public.sale_lines l on l.sale_id = s.id
      join public.user_category_access a on a.category_id = l.category_id and a.user_id = auth.uid()
      where s.id = p_sale_id
        and public.shop_date(s.created_at) = public.shop_date(now()))
    else false
  end
$$;

-- Sellers can't sell into a category they weren't granted, even by calling
-- the database directly. This runs inside sales_create_sale's transaction.
create or replace function public.sale_lines_check_category_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_access_category(new.category_id) then
    raise exception 'ليس لديك صلاحية البيع في هذا التصنيف'
      using errcode = '42501', hint = 'CATEGORY_FORBIDDEN';
  end if;
  return new;
end;
$$;

create trigger sale_lines_check_category_access
  before insert on public.sale_lines
  for each row execute function public.sale_lines_check_category_access();

create or replace function public.set_user_category_access(p_user_id uuid, p_category_ids bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_role('admin');
  delete from public.user_category_access where user_id = p_user_id;
  insert into public.user_category_access (user_id, category_id)
  select p_user_id, x from unnest(coalesce(p_category_ids, '{}')) as x group by x;
end;
$$;

-- Row visibility for sellers. Admins and managers keep full access.
drop policy categories_select on public.categories;
create policy categories_select on public.categories for select to authenticated
  using (public.can_access_category(id));

drop policy products_select on public.products;
create policy products_select on public.products for select to authenticated
  using (public.can_access_category(category_id));

drop policy sales_select on public.sales;
create policy sales_select on public.sales for select to authenticated
  using (public.sale_is_visible(id));

drop policy sale_lines_select on public.sale_lines;
create policy sale_lines_select on public.sale_lines for select to authenticated
  using (public.can_access_category(category_id) and public.sale_is_visible(sale_id));

-- ─── 4. Dashboard figures follow the same visibility rules ──────────────────
-- Sellers get their own visible totals; shop-wide configuration alerts and
-- stock figures are for managers only.
drop function public.dashboard_summary();

create function public.dashboard_summary()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today   date := public.shop_date(now());
  v_manager boolean := public.has_any_role('admin', 'manager');
begin
  -- Figures come from the sale-line view, so RLS limits what each user sees.
  return jsonb_build_object(
    'today', v_today,
    'sales_today', (select count(distinct r.sale_id) from public.v_sale_lines_report r
                     where r.status = 'completed' and r.sale_date = v_today),
    'revenue_today', (select coalesce(sum(r.line_total), 0) from public.v_sale_lines_report r
                       where r.status = 'completed' and r.sale_date = v_today),
    'bottles_today', (select coalesce(sum(r.quantity), 0) from public.v_sale_lines_report r
                       where r.status = 'completed' and r.sale_mode = 'perfume_formulation'
                         and r.sale_date = v_today),
    'low_stock_items', case when v_manager
                            then (select count(*) from public.v_inventory_stock v where v.active and v.is_low)
                            else 0 end,
    'missing_rules', case when v_manager
                          then (select count(*) from public.v_perfume_config_matrix m where m.missing_rule)
                          else 0 end,
    'missing_prices', case when v_manager
                           then (select count(*) from public.v_perfume_config_matrix m where m.missing_default_price)
                           else 0 end
  );
end;
$$;

grant execute on function
  public.dashboard_summary(),
  public.can_access_category(bigint),
  public.sale_is_visible(bigint),
  public.set_user_category_access(uuid, bigint[])
to authenticated;

-- ─── 5. New oils and sizes are enabled on restricted products automatically ─
-- A product with no restriction rows already allows everything. A product that
-- restricts oils (or sizes) gets each new option added, so the admin doesn't
-- have to edit every formulation.
create or replace function public.perfume_enable_new_option()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'oil_types' then
    insert into public.perfume_product_oil_types (product_id, oil_type_id)
    select distinct r.product_id, new.id from public.perfume_product_oil_types r
    on conflict do nothing;
  else
    insert into public.perfume_product_bottle_sizes (product_id, bottle_size_id)
    select distinct r.product_id, new.id from public.perfume_product_bottle_sizes r
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger oil_types_enable_on_restricted_products
  after insert on public.oil_types
  for each row execute function public.perfume_enable_new_option();

create trigger bottle_sizes_enable_on_restricted_products
  after insert on public.bottle_sizes
  for each row execute function public.perfume_enable_new_option();
