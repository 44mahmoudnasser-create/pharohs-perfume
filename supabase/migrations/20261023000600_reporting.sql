-- ════════════════════════════════════════════════════════════════════════════
-- 0600 — Reporting
-- Every report derives from sale lines or the inventory ledger, so totals are
-- always consistent with what was recorded. Views use security_invoker so the
-- caller's RLS applies. Days are computed in the shop timezone setting.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.shop_date(p_ts timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_ts at time zone public.setting_text('shop.timezone', 'UTC'))::date
$$;

-- Book stock per item (theoretical, not a verified physical count).
create view public.v_inventory_stock
with (security_invoker = true) as
select i.id as item_id, i.name, i.sku, i.unit, i.item_group, i.reorder_level, i.active,
       coalesce(b.quantity, 0) as quantity,
       b.last_movement_at,
       (coalesce(b.quantity, 0) <= i.reorder_level) as is_low,
       o.id as oil_type_id, o.name as oil_type_name,
       s.id as bottle_size_id, s.name as bottle_size_name, s.volume_ml
from public.inventory_items i
left join public.inventory_balances b on b.item_id = i.id
left join public.oil_types o on o.inventory_item_id = i.id
left join public.bottle_sizes s on s.inventory_item_id = i.id;

-- Flat sale lines with header and perfume details, for detail reports.
create view public.v_sale_lines_report
with (security_invoker = true) as
select l.id as sale_line_id, l.sale_id, s.status, s.created_at, public.shop_date(s.created_at) as sale_date,
       s.created_by, s.customer_name,
       l.line_no, l.product_id, l.product_name, l.category_id, l.category_name, l.sale_mode,
       l.quantity, l.list_unit_price, l.unit_price, l.line_total,
       d.bottle_size_id, d.bottle_size_name, d.bottle_volume_ml,
       d.oil_type_id, d.oil_type_name, d.grams_per_bottle, d.oil_grams_total
from public.sale_lines l
join public.sales s on s.id = l.sale_id
left join public.perfume_sale_line_details d on d.sale_line_id = l.id;

-- Aggregated sales of COMPLETED sales in [p_from, p_to] (shop-local dates).
-- p_dimension: day | product | category | bottle_size | oil_type
create or replace function public.report_sales_by(p_from date, p_to date, p_dimension text)
returns table (
  key          text,
  label        text,
  sales_count  bigint,
  quantity     numeric,
  revenue      numeric,
  oil_grams    numeric
)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_dimension not in ('day', 'product', 'category', 'bottle_size', 'oil_type') then
    raise exception 'نوع التقرير غير صالح' using errcode = 'P0001', hint = 'INVALID_DIMENSION';
  end if;

  return query
  select k.key, k.label,
         count(distinct r.sale_id),
         sum(r.quantity),
         sum(r.line_total),
         coalesce(sum(r.oil_grams_total), 0)
  from public.v_sale_lines_report r
  cross join lateral (
    select case p_dimension
             when 'day'         then r.sale_date::text
             when 'product'     then r.product_id::text
             when 'category'    then r.category_id::text
             when 'bottle_size' then r.bottle_size_id::text
             when 'oil_type'    then r.oil_type_id::text
           end as key,
           case p_dimension
             when 'day'         then r.sale_date::text
             when 'product'     then r.product_name
             when 'category'    then r.category_name
             when 'bottle_size' then r.bottle_size_name
             when 'oil_type'    then r.oil_type_name
           end as label
  ) k
  where r.status = 'completed'
    and r.sale_date between p_from and p_to
    and k.key is not null
  group by k.key, k.label
  order by case when p_dimension = 'day' then k.key end, sum(r.line_total) desc;
end;
$$;

-- Net stock consumed by sales per item in the period, from the ledger:
-- sale movements minus their reversals (cancellations), by movement date.
create or replace function public.report_stock_consumption(p_from date, p_to date, p_item_group text default null)
returns table (
  item_id           bigint,
  item_name         text,
  unit              text,
  item_group        text,
  oil_type_name     text,
  bottle_size_name  text,
  consumed          numeric,
  reversed          numeric,
  net_consumed      numeric
)
language sql
stable
set search_path = ''
as $$
  select i.id, i.name, i.unit, i.item_group, o.name, s.name,
         coalesce(sum(-m.quantity) filter (where m.movement_type = 'sale'), 0),
         coalesce(sum(m.quantity)  filter (where m.movement_type = 'reversal'), 0),
         coalesce(sum(-m.quantity), 0)
  from public.inventory_movements m
  join public.inventory_items i on i.id = m.item_id
  left join public.oil_types o on o.inventory_item_id = i.id
  left join public.bottle_sizes s on s.inventory_item_id = i.id
  where m.reference_type = 'sale'
    and m.movement_type in ('sale', 'reversal')
    and public.shop_date(m.created_at) between p_from and p_to
    and (p_item_group is null or i.item_group = p_item_group)
  group by i.id, i.name, i.unit, i.item_group, o.name, s.name, s.volume_ml
  order by i.item_group, s.volume_ml nulls first, i.name
$$;

-- Dashboard figures for "today" in the shop timezone.
create or replace function public.dashboard_summary()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'today', public.shop_date(now()),
    'sales_today',   (select count(*) from public.sales s
                      where s.status = 'completed' and public.shop_date(s.created_at) = public.shop_date(now())),
    'revenue_today', (select coalesce(sum(s.total), 0) from public.sales s
                      where s.status = 'completed' and public.shop_date(s.created_at) = public.shop_date(now())),
    'bottles_today', (select coalesce(sum(r.quantity), 0) from public.v_sale_lines_report r
                      where r.status = 'completed' and r.sale_mode = 'perfume_formulation'
                        and r.sale_date = public.shop_date(now())),
    'low_stock_items', (select count(*) from public.v_inventory_stock v where v.active and v.is_low),
    'missing_rules',   (select count(*) from public.v_perfume_config_matrix m where m.missing_rule),
    'missing_prices',  (select count(*) from public.v_perfume_config_matrix m where m.missing_default_price)
  )
$$;
