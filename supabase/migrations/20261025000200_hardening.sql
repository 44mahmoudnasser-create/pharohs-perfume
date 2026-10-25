-- ════════════════════════════════════════════════════════════════════════════
-- 0902 — Hardening
--   • sales.total is no longer readable by API roles (sellers could read the
--     full value of invoices that contain lines they can't see). Totals shown
--     to users are sums of visible lines.
--   • Stock balances and item records are readable by admins and managers only.
--     Sellers get availability through narrow functions instead.
--   • Settings and user changes are saved in one transaction each.
--   • Settings validate their own values (types, timezone name, known keys).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. sales.total ─────────────────────────────────────────────────────────
-- Table-level SELECT is replaced by an explicit column list.
revoke select on public.sales from authenticated;
grant select (id, status, customer_name, notes, created_by, created_at,
              cancelled_at, cancelled_by, cancel_reason, updated_at)
  on public.sales to authenticated;

-- ─── 2. Stock visibility ────────────────────────────────────────────────────
drop policy inventory_items_select on public.inventory_items;
create policy inventory_items_select on public.inventory_items for select to authenticated
  using ((select public.has_any_role('admin', 'manager')));

drop policy inventory_balances_select on public.inventory_balances;
create policy inventory_balances_select on public.inventory_balances for select to authenticated
  using ((select public.has_any_role('admin', 'manager')));

-- Sale-screen availability for perfumes. Runs as owner so it can read balances,
-- and checks product access itself (it returns no rows for ungranted categories).
create or replace function public.perfume_sale_options(p_product_id bigint)
returns table (
  bottle_size_id    bigint,
  bottle_size_name  text,
  volume_ml         numeric,
  oil_type_id       bigint,
  oil_type_name     text,
  rule_id           bigint,
  grams_per_bottle  numeric,
  unit_price        numeric,
  oil_available     numeric,
  bottles_available numeric,
  max_units         integer,
  status            text   -- ok | not_allowed | missing_rule | missing_price | out_of_stock
)
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select pr.id from public.products pr
    where pr.id = p_product_id
      and pr.sale_mode = 'perfume_formulation'
      and public.can_access_category(pr.category_id)
  ),
  combos as (
    select s.id as size_id, s.name as size_name, s.volume_ml, s.sort_order as s_sort,
           s.inventory_item_id as bottle_item,
           o.id as oil_id, o.name as oil_name, o.sort_order as o_sort,
           o.inventory_item_id as oil_item,
           (   not exists (select 1 from public.perfume_product_bottle_sizes r where r.product_id = p_product_id)
            or exists (select 1 from public.perfume_product_bottle_sizes r
                       where r.product_id = p_product_id and r.bottle_size_id = s.id))
       and (   not exists (select 1 from public.perfume_product_oil_types r where r.product_id = p_product_id)
            or exists (select 1 from public.perfume_product_oil_types r
                       where r.product_id = p_product_id and r.oil_type_id = o.id)) as allowed
    from p
    cross join public.bottle_sizes s
    cross join public.oil_types o
    where s.active and o.active
  )
  select c.size_id, c.size_name, c.volume_ml, c.oil_id, c.oil_name,
         r.id, r.grams_per_bottle,
         coalesce(pp.price, dp.price),
         ob.quantity, bb.quantity,
         case when r.id is null then null
              else greatest(0, least(floor(ob.quantity / r.grams_per_bottle), floor(bb.quantity)))::integer end,
         case when not c.allowed then 'not_allowed'
              when r.id is null then 'missing_rule'
              when coalesce(pp.price, dp.price) is null then 'missing_price'
              when ob.quantity < r.grams_per_bottle or bb.quantity < 1 then 'out_of_stock'
              else 'ok' end
  from combos c
  left join public.oil_consumption_rules r on r.oil_type_id = c.oil_id and r.bottle_size_id = c.size_id
  left join public.perfume_prices pp on pp.product_id = p_product_id and pp.bottle_size_id = c.size_id and pp.oil_type_id = c.oil_id
  left join public.perfume_prices dp on dp.product_id is null       and dp.bottle_size_id = c.size_id and dp.oil_type_id = c.oil_id
  left join public.inventory_balances ob on ob.item_id = c.oil_item
  left join public.inventory_balances bb on bb.item_id = c.bottle_item
  order by c.s_sort, c.volume_ml, c.o_sort, c.oil_name
$$;

-- Availability of a ready-made product's stock item, for the sale screen.
create or replace function public.sale_product_available(p_product_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('quantity', b.quantity, 'unit', i.unit)
  from public.products p
  join public.inventory_items i on i.id = p.inventory_item_id
  join public.inventory_balances b on b.item_id = i.id
  where p.id = p_product_id
    and p.sale_mode = 'stock_item'
    and public.can_access_category(p.category_id)
$$;

grant execute on function public.sale_product_available(bigint) to authenticated;

-- ─── 3. Settings: one transaction, validated on the server ──────────────────
create or replace function public.save_app_settings(p_values jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  perform public.require_role('admin');

  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'بيانات الإعدادات غير صالحة' using errcode = 'P0001', hint = 'INVALID_SETTINGS';
  end if;

  for v_key in select jsonb_object_keys(p_values) loop
    if not exists (select 1 from public.app_settings s where s.key = v_key) then
      raise exception 'إعداد غير معروف: %', v_key using errcode = 'P0001', hint = 'UNKNOWN_SETTING';
    end if;
  end loop;

  if p_values ? 'shop.name' and (jsonb_typeof(p_values -> 'shop.name') <> 'string'
                                 or btrim(p_values ->> 'shop.name') = '') then
    raise exception 'اسم المتجر مطلوب' using errcode = 'P0001', hint = 'INVALID_SETTING';
  end if;
  if p_values ? 'shop.currency' and jsonb_typeof(p_values -> 'shop.currency') <> 'string' then
    raise exception 'رمز العملة غير صالح' using errcode = 'P0001', hint = 'INVALID_SETTING';
  end if;
  if p_values ? 'shop.timezone' then
    if jsonb_typeof(p_values -> 'shop.timezone') <> 'string' then
      raise exception 'المنطقة الزمنية غير صالحة' using errcode = 'P0001', hint = 'INVALID_SETTING';
    end if;
    -- raises 22023 for an unknown zone name
    perform now() at time zone (p_values ->> 'shop.timezone');
  end if;
  if p_values ? 'inventory.allow_negative_stock' and jsonb_typeof(p_values -> 'inventory.allow_negative_stock') <> 'boolean' then
    raise exception 'قيمة الإعداد يجب أن تكون نعم أو لا' using errcode = 'P0001', hint = 'INVALID_SETTING';
  end if;
  if p_values ? 'sales.allow_price_override' and jsonb_typeof(p_values -> 'sales.allow_price_override') <> 'boolean' then
    raise exception 'قيمة الإعداد يجب أن تكون نعم أو لا' using errcode = 'P0001', hint = 'INVALID_SETTING';
  end if;

  -- one statement: either every value is written or none is
  update public.app_settings s
     set value = v.value
    from jsonb_each(p_values) as v(key, value)
   where s.key = v.key;
end;
$$;

-- ─── 4. Users: one transaction for profile, role, activation and grants ─────
create or replace function public.admin_save_user(
  p_user_id      uuid,
  p_full_name    text,
  p_role         text,
  p_active       boolean,
  p_category_ids bigint[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_role('admin');

  update public.app_users
     set full_name = nullif(btrim(p_full_name), ''),
         role = p_role,
         active = p_active
   where id = p_user_id;
  if not found then
    raise exception 'المستخدم غير موجود' using errcode = 'P0001', hint = 'USER_NOT_FOUND';
  end if;

  -- grants only mean something for sellers; clear them otherwise
  delete from public.user_category_access where user_id = p_user_id;
  if p_role = 'seller' then
    insert into public.user_category_access (user_id, category_id)
    select p_user_id, x from unnest(coalesce(p_category_ids, '{}')) as x group by x;
  end if;
end;
$$;

grant execute on function
  public.save_app_settings(jsonb),
  public.admin_save_user(uuid, text, text, boolean, bigint[]),
  public.sale_product_available(bigint),
  public.perfume_sale_options(bigint)
to authenticated;
