-- ════════════════════════════════════════════════════════════════════════════
-- 0400 — Perfume-specific configuration
--   bottle_sizes            : sellable sizes; each is backed by an inventory item (pcs)
--   oil_types               : oil grades; each is backed by an inventory item (g)
--   oil_consumption_rules   : grams of oil per bottle for (oil type, bottle size)
--   perfume_prices          : sale price per (size, oil), optionally per product
--   perfume_product_*       : optional per-product restrictions of sizes / oils
--   perfume_extra_components: optional recipe (BOM) lines, e.g. alcohol per bottle
-- All of it is data; nothing here is hard-coded in the frontend.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Bottle sizes ───────────────────────────────────────────────────────────
create table public.bottle_sizes (
  id                 bigint generated always as identity primary key,
  name               text not null check (btrim(name) <> ''),
  volume_ml          numeric(8, 2) not null check (volume_ml > 0),
  -- empty-bottle stock for this size (unit = pcs). Auto-created on insert.
  inventory_item_id  bigint not null unique references public.inventory_items (id) on delete restrict,
  sort_order         integer not null default 0,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index bottle_sizes_name_key on public.bottle_sizes (lower(btrim(name)));

-- ─── Oil types ──────────────────────────────────────────────────────────────
create table public.oil_types (
  id                 bigint generated always as identity primary key,
  name               text not null check (btrim(name) <> ''),
  description        text,
  -- oil stock for this type (unit = g, because consumption rules are in grams)
  inventory_item_id  bigint not null unique references public.inventory_items (id) on delete restrict,
  sort_order         integer not null default 0,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index oil_types_name_key on public.oil_types (lower(btrim(name)));

-- Creates / renames the backing inventory item so admins never have to manage
-- the link by hand. The backing item's unit is fixed: pcs for bottles, g for oil.
create or replace function public.perfume_link_inventory_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_name text;
  v_unit      text;
  v_group     text;
begin
  if tg_table_name = 'bottle_sizes' then
    v_item_name := 'زجاجة فارغة ' || btrim(new.name);
    v_unit := 'pcs'; v_group := 'packaging';
  else
    v_item_name := 'زيت ' || btrim(new.name);
    v_unit := 'g'; v_group := 'raw_material';
  end if;

  if tg_op = 'INSERT' then
    if new.inventory_item_id is null then
      insert into public.inventory_items (name, unit, item_group)
      values (v_item_name, v_unit, v_group)
      returning id into new.inventory_item_id;
    elsif not exists (select 1 from public.inventory_items i
                      where i.id = new.inventory_item_id and i.unit = v_unit) then
      raise exception 'صنف المخزون المرتبط يجب أن تكون وحدته %', v_unit
        using errcode = 'P0001', hint = 'UNIT_MISMATCH';
    end if;
  elsif new.inventory_item_id <> old.inventory_item_id then
    raise exception 'لا يمكن تغيير صنف المخزون المرتبط' using errcode = 'P0001', hint = 'ITEM_LINK_LOCKED';
  elsif btrim(new.name) <> btrim(old.name) then
    update public.inventory_items set name = v_item_name where id = new.inventory_item_id;
  end if;

  -- keep the backing item's active flag in sync
  if tg_op = 'UPDATE' and new.active <> old.active then
    update public.inventory_items set active = new.active where id = new.inventory_item_id;
  end if;
  return new;
end;
$$;

create trigger bottle_sizes_link_item
  before insert or update on public.bottle_sizes
  for each row execute function public.perfume_link_inventory_item();
create trigger oil_types_link_item
  before insert or update on public.oil_types
  for each row execute function public.perfume_link_inventory_item();

create trigger bottle_sizes_set_updated_at before update on public.bottle_sizes
  for each row execute function public.set_updated_at();
create trigger oil_types_set_updated_at before update on public.oil_types
  for each row execute function public.set_updated_at();

create trigger bottle_sizes_audit after insert or update or delete on public.bottle_sizes
  for each row execute function public.audit_row_change('id');
create trigger oil_types_audit after insert or update or delete on public.oil_types
  for each row execute function public.audit_row_change('id');

-- ─── Oil consumption rules ──────────────────────────────────────────────────
-- Business rule: a perfume bottle of size S made with oil type O consumes
-- exactly grams_per_bottle grams of O's oil stock. A missing row means the
-- combination is NOT configured and cannot be sold (never assumed to be zero).
-- Editing a rule only affects future sales; each sale line stores a snapshot.
create table public.oil_consumption_rules (
  id                bigint generated always as identity primary key,
  oil_type_id       bigint not null references public.oil_types (id) on delete restrict,
  bottle_size_id    bigint not null references public.bottle_sizes (id) on delete restrict,
  grams_per_bottle  numeric(10, 3) not null check (grams_per_bottle > 0),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint oil_consumption_rules_combo_key unique (oil_type_id, bottle_size_id)
);

create index oil_consumption_rules_size_idx on public.oil_consumption_rules (bottle_size_id);

create trigger oil_consumption_rules_set_updated_at before update on public.oil_consumption_rules
  for each row execute function public.set_updated_at();
create trigger oil_consumption_rules_audit after insert or update or delete on public.oil_consumption_rules
  for each row execute function public.audit_row_change('id');

-- ─── Prices ─────────────────────────────────────────────────────────────────
-- product_id NULL = default price for every formulation; a row with a
-- product_id overrides the default for that product only.
create table public.perfume_prices (
  id              bigint generated always as identity primary key,
  product_id      bigint references public.products (id) on delete cascade,
  bottle_size_id  bigint not null references public.bottle_sizes (id) on delete restrict,
  oil_type_id     bigint not null references public.oil_types (id) on delete restrict,
  price           numeric(12, 2) not null check (price >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint perfume_prices_combo_key unique nulls not distinct (product_id, bottle_size_id, oil_type_id)
);

create index perfume_prices_lookup_idx on public.perfume_prices (bottle_size_id, oil_type_id);

create trigger perfume_prices_set_updated_at before update on public.perfume_prices
  for each row execute function public.set_updated_at();
create trigger perfume_prices_audit after insert or update or delete on public.perfume_prices
  for each row execute function public.audit_row_change('id');

-- ─── Per-product restrictions ───────────────────────────────────────────────
-- If a product has NO rows in a table, every active size / oil type is allowed.
-- If it has rows, only the listed ones are allowed.
create table public.perfume_product_bottle_sizes (
  product_id      bigint not null references public.products (id) on delete cascade,
  bottle_size_id  bigint not null references public.bottle_sizes (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (product_id, bottle_size_id)
);

create table public.perfume_product_oil_types (
  product_id   bigint not null references public.products (id) on delete cascade,
  oil_type_id  bigint not null references public.oil_types (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (product_id, oil_type_id)
);

-- Replaces a product's restrictions in one transaction. Empty arrays = no
-- restriction. SECURITY INVOKER: the caller's RLS policies apply.
create or replace function public.perfume_set_product_restrictions(
  p_product_id      bigint,
  p_bottle_size_ids bigint[],
  p_oil_type_ids    bigint[]
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- explicit check so an unauthorized call fails loudly instead of RLS silently filtering it
  if not public.has_any_role('admin', 'manager') then
    raise exception 'ليس لديك صلاحية لتنفيذ هذه العملية' using errcode = '42501', hint = 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.products p
                 where p.id = p_product_id and p.sale_mode = 'perfume_formulation') then
    raise exception 'المنتج ليس تركيبة عطر' using errcode = 'P0001', hint = 'NOT_A_FORMULATION';
  end if;

  delete from public.perfume_product_bottle_sizes where product_id = p_product_id;
  delete from public.perfume_product_oil_types    where product_id = p_product_id;

  insert into public.perfume_product_bottle_sizes (product_id, bottle_size_id)
  select p_product_id, x from unnest(coalesce(p_bottle_size_ids, '{}')) as x group by x;
  insert into public.perfume_product_oil_types (product_id, oil_type_id)
  select p_product_id, x from unnest(coalesce(p_oil_type_ids, '{}')) as x group by x;
end;
$$;

-- ─── Optional extra recipe components (BOM extension point) ────────────────
-- Empty by default, so version 1 deducts only oil + bottle. Adding e.g. an
-- alcohol item here (per size and/or oil type) makes every future perfume sale
-- deduct it too, without changing the sales engine.
create table public.perfume_extra_components (
  id                   bigint generated always as identity primary key,
  bottle_size_id       bigint references public.bottle_sizes (id) on delete cascade,  -- NULL = all sizes
  oil_type_id          bigint references public.oil_types (id) on delete cascade,     -- NULL = all oil types
  inventory_item_id    bigint not null references public.inventory_items (id) on delete restrict,
  quantity_per_bottle  numeric(14, 3) not null check (quantity_per_bottle > 0),
  active               boolean not null default true,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint perfume_extra_components_key unique nulls not distinct (bottle_size_id, oil_type_id, inventory_item_id)
);

create trigger perfume_extra_components_set_updated_at before update on public.perfume_extra_components
  for each row execute function public.set_updated_at();
create trigger perfume_extra_components_audit after insert or update or delete on public.perfume_extra_components
  for each row execute function public.audit_row_change('id');

-- ─── Resolver used by the sales engine ──────────────────────────────────────
-- Validates a (product, size, oil) selection and returns its price and stock
-- components. Raises a clear error for every invalid case.
create or replace function public.perfume_resolve_line(
  p_product_id      bigint,
  p_bottle_size_id  bigint,
  p_oil_type_id     bigint
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_size   public.bottle_sizes%rowtype;
  v_oil    public.oil_types%rowtype;
  v_rule   public.oil_consumption_rules%rowtype;
  v_price  numeric(12, 2);
  v_components jsonb;
begin
  if p_bottle_size_id is null or p_oil_type_id is null then
    raise exception 'يجب اختيار حجم الزجاجة ونوع الزيت' using errcode = 'P0001', hint = 'SELECTION_REQUIRED';
  end if;

  select * into v_size from public.bottle_sizes where id = p_bottle_size_id;
  if not found or not v_size.active then
    raise exception 'حجم الزجاجة غير متاح' using errcode = 'P0001', hint = 'SIZE_UNAVAILABLE';
  end if;

  select * into v_oil from public.oil_types where id = p_oil_type_id;
  if not found or not v_oil.active then
    raise exception 'نوع الزيت غير متاح' using errcode = 'P0001', hint = 'OIL_UNAVAILABLE';
  end if;

  if exists (select 1 from public.perfume_product_bottle_sizes r where r.product_id = p_product_id)
     and not exists (select 1 from public.perfume_product_bottle_sizes r
                     where r.product_id = p_product_id and r.bottle_size_id = p_bottle_size_id) then
    raise exception 'الحجم % غير مسموح لهذا العطر', v_size.name using errcode = 'P0001', hint = 'SIZE_NOT_ALLOWED';
  end if;
  if exists (select 1 from public.perfume_product_oil_types r where r.product_id = p_product_id)
     and not exists (select 1 from public.perfume_product_oil_types r
                     where r.product_id = p_product_id and r.oil_type_id = p_oil_type_id) then
    raise exception 'نوع الزيت % غير مسموح لهذا العطر', v_oil.name using errcode = 'P0001', hint = 'OIL_NOT_ALLOWED';
  end if;

  select * into v_rule from public.oil_consumption_rules
  where oil_type_id = p_oil_type_id and bottle_size_id = p_bottle_size_id;
  if not found then
    raise exception 'لا توجد قاعدة استهلاك للزيت "%" مع الحجم "%". يجب على مدير النظام إضافتها أولاً',
      v_oil.name, v_size.name using errcode = 'P0001', hint = 'MISSING_CONSUMPTION_RULE';
  end if;

  select coalesce(
           (select pp.price from public.perfume_prices pp
            where pp.product_id = p_product_id and pp.bottle_size_id = p_bottle_size_id and pp.oil_type_id = p_oil_type_id),
           (select pp.price from public.perfume_prices pp
            where pp.product_id is null and pp.bottle_size_id = p_bottle_size_id and pp.oil_type_id = p_oil_type_id))
    into v_price;
  if v_price is null then
    raise exception 'لا يوجد سعر محدد للحجم "%" مع الزيت "%"', v_size.name, v_oil.name
      using errcode = 'P0001', hint = 'MISSING_PRICE';
  end if;

  -- components per ONE bottle: oil, empty bottle, then optional extras
  select jsonb_agg(c order by c.ord) into v_components
  from (
    select 1 as ord, v_oil.inventory_item_id as item_id, v_rule.grams_per_bottle as quantity_per_unit,
           'oil_consumption_rule' as source, v_rule.id as source_id
    union all
    select 2, v_size.inventory_item_id, 1::numeric, 'bottle_size', v_size.id
    union all
    select 3, e.inventory_item_id, e.quantity_per_bottle, 'perfume_extra_component', e.id
    from public.perfume_extra_components e
    where e.active
      and (e.bottle_size_id is null or e.bottle_size_id = p_bottle_size_id)
      and (e.oil_type_id    is null or e.oil_type_id    = p_oil_type_id)
  ) c;

  return jsonb_build_object(
    'unit_price', v_price,
    'components', v_components,
    'details', jsonb_build_object(
      'bottle_size_id',      v_size.id,
      'bottle_size_name',    v_size.name,
      'bottle_volume_ml',    v_size.volume_ml,
      'oil_type_id',         v_oil.id,
      'oil_type_name',       v_oil.name,
      'consumption_rule_id', v_rule.id,
      'grams_per_bottle',    v_rule.grams_per_bottle
    )
  );
end;
$$;

-- ─── Options shown on the sales screen ──────────────────────────────────────
-- One row per active (size, oil) pair with its status. The UI only displays
-- what this returns; the sales RPC re-validates everything at commit time.
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
set search_path = ''
as $$
  with p as (
    select pr.id from public.products pr
    where pr.id = p_product_id and pr.sale_mode = 'perfume_formulation'
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

comment on function public.perfume_sale_options(bigint) is
  'max_units ignores extra components and other cart lines; final stock validation happens in sales_create_sale.';

-- ─── Configuration gaps (admin review) ──────────────────────────────────────
create view public.v_perfume_config_matrix
with (security_invoker = true) as
select o.id  as oil_type_id,  o.name as oil_type_name,  o.sort_order as oil_sort,
       s.id  as bottle_size_id, s.name as bottle_size_name, s.volume_ml, s.sort_order as size_sort,
       r.id  as rule_id, r.grams_per_bottle,
       dp.id as default_price_id, dp.price as default_price,
       (r.id is null)  as missing_rule,
       (dp.id is null) as missing_default_price
from public.oil_types o
cross join public.bottle_sizes s
left join public.oil_consumption_rules r on r.oil_type_id = o.id and r.bottle_size_id = s.id
left join public.perfume_prices dp on dp.product_id is null and dp.oil_type_id = o.id and dp.bottle_size_id = s.id
where o.active and s.active;
