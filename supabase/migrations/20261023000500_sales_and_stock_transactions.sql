-- ════════════════════════════════════════════════════════════════════════════
-- 0500 — Sales engine (reusable) + perfume line details (perfume extension)
--
-- sales_create_sale() is the ONLY way to create a sale. In one transaction it:
--   1. de-duplicates by idempotency key (double clicks / retries),
--   2. resolves each line into a price and stock components via the resolver
--      for the product's sale_mode,
--   3. locks every affected balance row (ordered by item id → no deadlocks)
--      and rejects the sale if any stock is insufficient,
--   4. writes the sale, lines, snapshots, components and ledger movements.
-- Any error rolls back everything, so partial sales cannot exist.
-- ════════════════════════════════════════════════════════════════════════════

create table public.sales (
  id               bigint generated always as identity primary key,
  status           text not null default 'completed' check (status in ('completed', 'cancelled')),
  -- client-generated UUID per checkout attempt; retries reuse it
  idempotency_key  uuid not null unique,
  customer_name    text,
  notes            text,
  total            numeric(12, 2) not null check (total >= 0),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  cancelled_at     timestamptz,
  cancelled_by     uuid,
  cancel_reason    text,
  constraint sales_cancel_fields check (
    (status = 'cancelled') = (cancelled_at is not null)
    and (status <> 'cancelled' or coalesce(btrim(cancel_reason), '') <> '')
  )
);

create index sales_created_at_idx on public.sales (created_at desc);
create index sales_status_created_idx on public.sales (status, created_at desc);
create index sales_created_by_idx on public.sales (created_by);

create table public.sale_lines (
  id               bigint generated always as identity primary key,
  sale_id          bigint not null references public.sales (id) on delete restrict,
  line_no          integer not null check (line_no > 0),
  product_id       bigint not null references public.products (id) on delete restrict,
  -- snapshots: reports must not change when names / prices change later
  product_name     text not null,
  category_id      bigint not null references public.categories (id) on delete restrict,
  category_name    text not null,
  sale_mode        text not null,
  quantity         numeric(12, 3) not null check (quantity > 0),
  list_unit_price  numeric(12, 2) not null check (list_unit_price >= 0),
  unit_price       numeric(12, 2) not null check (unit_price >= 0),
  line_total       numeric(12, 2) not null check (line_total >= 0),
  created_at       timestamptz not null default now(),
  constraint sale_lines_line_no_key unique (sale_id, line_no)
);

create index sale_lines_product_idx on public.sale_lines (product_id);
create index sale_lines_category_idx on public.sale_lines (category_id);

-- Stock consumed by each line (one row per inventory item), with its ledger movement.
create table public.sale_line_components (
  id                 bigint generated always as identity primary key,
  sale_line_id       bigint not null references public.sale_lines (id) on delete restrict,
  inventory_item_id  bigint not null references public.inventory_items (id) on delete restrict,
  item_name          text not null,
  unit               text not null,
  quantity_per_unit  numeric(14, 3) not null check (quantity_per_unit > 0),
  quantity_total     numeric(14, 3) not null check (quantity_total > 0),
  source             text not null,   -- oil_consumption_rule | bottle_size | perfume_extra_component | product
  source_id          bigint,
  movement_id        bigint not null unique references public.inventory_movements (id) on delete restrict,
  created_at         timestamptz not null default now()
);

create index sale_line_components_line_idx on public.sale_line_components (sale_line_id);
create index sale_line_components_item_idx on public.sale_line_components (inventory_item_id);

-- Perfume extension of a sale line: the selected size / oil and the rule
-- snapshot actually used. Historical grams never change when rules change.
create table public.perfume_sale_line_details (
  sale_line_id         bigint primary key references public.sale_lines (id) on delete restrict,
  bottle_size_id       bigint not null references public.bottle_sizes (id) on delete restrict,
  bottle_size_name     text not null,
  bottle_volume_ml     numeric(8, 2) not null,
  oil_type_id          bigint not null references public.oil_types (id) on delete restrict,
  oil_type_name        text not null,
  consumption_rule_id  bigint references public.oil_consumption_rules (id) on delete restrict,
  grams_per_bottle     numeric(10, 3) not null check (grams_per_bottle > 0),
  bottles_total        numeric(12, 3) not null check (bottles_total > 0),
  oil_grams_total      numeric(14, 3) not null check (oil_grams_total > 0),
  created_at           timestamptz not null default now()
);

create index perfume_sale_line_details_size_idx on public.perfume_sale_line_details (bottle_size_id);
create index perfume_sale_line_details_oil_idx  on public.perfume_sale_line_details (oil_type_id);

-- ─── Immutability ───────────────────────────────────────────────────────────
create or replace function public.sales_rows_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'بيانات البيع المسجلة لا يمكن تعديلها أو حذفها؛ استخدم إلغاء الفاتورة'
    using errcode = 'P0001', hint = 'SALE_IMMUTABLE';
end;
$$;

create trigger sale_lines_immutable before update or delete on public.sale_lines
  for each row execute function public.sales_rows_immutable();
create trigger sale_line_components_immutable before update or delete on public.sale_line_components
  for each row execute function public.sales_rows_immutable();
create trigger perfume_sale_line_details_immutable before update or delete on public.perfume_sale_line_details
  for each row execute function public.sales_rows_immutable();

-- The header may only move completed → cancelled (with its cancellation fields).
create or replace function public.sales_header_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable constant text[] := array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    raise exception 'لا يمكن حذف فاتورة؛ استخدم الإلغاء' using errcode = 'P0001', hint = 'SALE_IMMUTABLE';
  end if;
  if (to_jsonb(new) - v_mutable) <> (to_jsonb(old) - v_mutable)
     or old.status <> 'completed' or new.status <> 'cancelled' then
    raise exception 'التعديل الوحيد المسموح على الفاتورة هو الإلغاء' using errcode = 'P0001', hint = 'SALE_IMMUTABLE';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger sales_header_guard before update or delete on public.sales
  for each row execute function public.sales_header_guard();

-- ─── Create sale (RPC) ──────────────────────────────────────────────────────
-- p_lines: [{ "product_id": 1, "quantity": 2,
--             "bottle_size_id": 3, "oil_type_id": 1,      -- perfume_formulation only
--             "unit_price": 150.00 }]                        -- optional override
create or replace function public.sales_create_sale(
  p_idempotency_key uuid,
  p_lines           jsonb,
  p_customer_name   text default null,
  p_notes           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid             uuid := auth.uid();
  v_existing        public.sales%rowtype;
  v_allow_override  boolean;
  v_allow_negative  boolean;
  v_line            jsonb;
  v_line_no         integer;
  v_product         record;
  v_qty             numeric;
  v_list_price      numeric(12, 2);
  v_unit_price      numeric(12, 2);
  v_components      jsonb;
  v_details         jsonb;
  v_resolved        jsonb := '[]'::jsonb;
  v_resolution      jsonb;
  v_total           numeric(12, 2) := 0;
  v_req             record;
  v_shortages       text[] := '{}';
  v_sale_id         bigint;
  v_line_id         bigint;
  v_comp            jsonb;
  v_comp_total      numeric(14, 3);
  v_movement_id     bigint;
  v_item            record;
begin
  perform public.require_role('admin', 'manager', 'seller');

  if p_idempotency_key is null then
    raise exception 'مفتاح العملية مطلوب' using errcode = 'P0001', hint = 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  -- Serialize attempts that share a key, then return the first result on retry.
  perform pg_advisory_xact_lock(hashtextextended('sale:' || p_idempotency_key::text, 0));
  select * into v_existing from public.sales s where s.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.created_by is distinct from v_uid then
      raise exception 'مفتاح العملية مستخدم من قبل' using errcode = 'P0001', hint = 'IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('sale_id', v_existing.id, 'total', v_existing.total, 'duplicate', true);
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'الفاتورة يجب أن تحتوي على صنف واحد على الأقل' using errcode = 'P0001', hint = 'EMPTY_SALE';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'عدد الأصناف في الفاتورة كبير جداً' using errcode = 'P0001', hint = 'TOO_MANY_LINES';
  end if;

  v_allow_override := public.has_any_role('admin', 'manager')
                      or public.setting_bool('sales.allow_price_override', false);
  v_allow_negative := public.setting_bool('inventory.allow_negative_stock', false);

  -- ── 1. Resolve every line (validation + price + components) ──
  for v_line, v_line_no in
    select e.value, e.ordinality::integer from jsonb_array_elements(p_lines) with ordinality e
  loop
    begin
      v_qty := (v_line ->> 'quantity')::numeric;
    exception when others then
      v_qty := null;
    end;
    if v_qty is null or v_qty <= 0 then
      raise exception 'الكمية في السطر % يجب أن تكون أكبر من صفر', v_line_no
        using errcode = 'P0001', hint = 'INVALID_QUANTITY';
    end if;

    select p.id, p.name, p.active, p.sale_mode, p.unit_price, p.inventory_item_id,
           c.id as category_id, c.name as category_name, c.active as category_active
      into v_product
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.id = (v_line ->> 'product_id')::bigint;

    if not found then
      raise exception 'المنتج في السطر % غير موجود', v_line_no using errcode = 'P0001', hint = 'PRODUCT_NOT_FOUND';
    end if;
    if not v_product.active or not v_product.category_active then
      raise exception 'المنتج "%" غير متاح للبيع', v_product.name using errcode = 'P0001', hint = 'PRODUCT_INACTIVE';
    end if;

    -- Resolver dispatch: add a new WHEN branch for a new sale mode.
    case v_product.sale_mode
      when 'stock_item' then
        v_list_price := v_product.unit_price;
        v_components := jsonb_build_array(jsonb_build_object(
          'item_id', v_product.inventory_item_id, 'quantity_per_unit', 1,
          'source', 'product', 'source_id', v_product.id));
        v_details := null;
      when 'perfume_formulation' then
        if v_qty <> trunc(v_qty) then
          raise exception 'عدد الزجاجات يجب أن يكون رقماً صحيحاً' using errcode = 'P0001', hint = 'INVALID_QUANTITY';
        end if;
        v_resolution := public.perfume_resolve_line(
          v_product.id,
          (v_line ->> 'bottle_size_id')::bigint,
          (v_line ->> 'oil_type_id')::bigint);
        v_list_price := (v_resolution ->> 'unit_price')::numeric;
        v_components := v_resolution -> 'components';
        v_details    := v_resolution -> 'details';
      else
        raise exception 'طريقة البيع "%" غير مدعومة', v_product.sale_mode
          using errcode = 'P0001', hint = 'UNSUPPORTED_SALE_MODE';
    end case;

    v_unit_price := v_list_price;
    if v_line ? 'unit_price' and jsonb_typeof(v_line -> 'unit_price') = 'number'
       and (v_line ->> 'unit_price')::numeric <> v_list_price then
      if not v_allow_override then
        raise exception 'ليس لديك صلاحية تعديل سعر البيع' using errcode = '42501', hint = 'PRICE_OVERRIDE_FORBIDDEN';
      end if;
      v_unit_price := round((v_line ->> 'unit_price')::numeric, 2);
      if v_unit_price < 0 then
        raise exception 'السعر لا يمكن أن يكون بالسالب' using errcode = 'P0001', hint = 'INVALID_PRICE';
      end if;
    end if;

    v_total := v_total + round(v_unit_price * v_qty, 2);
    v_resolved := v_resolved || jsonb_build_object(
      'line_no', v_line_no, 'product_id', v_product.id, 'product_name', v_product.name,
      'category_id', v_product.category_id, 'category_name', v_product.category_name,
      'sale_mode', v_product.sale_mode, 'quantity', v_qty,
      'list_unit_price', v_list_price, 'unit_price', v_unit_price,
      'components', v_components, 'details', v_details);
  end loop;

  -- ── 2. Lock balances in item-id order and check availability ──
  for v_req in
    select (c ->> 'item_id')::bigint as item_id,
           sum((c ->> 'quantity_per_unit')::numeric * (l ->> 'quantity')::numeric) as required
    from jsonb_array_elements(v_resolved) l
    cross join jsonb_array_elements(l -> 'components') c
    group by 1
    order by 1
  loop
    select i.name, i.unit, i.active, b.quantity into v_item
    from public.inventory_balances b
    join public.inventory_items i on i.id = b.item_id
    where b.item_id = v_req.item_id
    for update of b;

    if not found or not v_item.active then
      raise exception 'صنف المخزون رقم % غير متاح', v_req.item_id using errcode = 'P0001', hint = 'ITEM_INACTIVE';
    end if;
    if v_item.quantity < v_req.required and not v_allow_negative then
      v_shortages := v_shortages || format('%s: المتاح %s %s، المطلوب %s %s',
        v_item.name, trim_scale(v_item.quantity), v_item.unit, trim_scale(v_req.required), v_item.unit);
    end if;
  end loop;

  if cardinality(v_shortages) > 0 then
    raise exception 'المخزون غير كافٍ — %', array_to_string(v_shortages, ' | ')
      using errcode = 'P0001', hint = 'INSUFFICIENT_STOCK';
  end if;

  -- ── 3. Write everything ──
  insert into public.sales (idempotency_key, customer_name, notes, total, created_by)
  values (p_idempotency_key, nullif(btrim(p_customer_name), ''), nullif(btrim(p_notes), ''), v_total, v_uid)
  returning id into v_sale_id;

  for v_line in select value from jsonb_array_elements(v_resolved) loop
    insert into public.sale_lines (
      sale_id, line_no, product_id, product_name, category_id, category_name, sale_mode,
      quantity, list_unit_price, unit_price, line_total)
    values (
      v_sale_id, (v_line ->> 'line_no')::integer, (v_line ->> 'product_id')::bigint,
      v_line ->> 'product_name', (v_line ->> 'category_id')::bigint, v_line ->> 'category_name',
      v_line ->> 'sale_mode', (v_line ->> 'quantity')::numeric,
      (v_line ->> 'list_unit_price')::numeric, (v_line ->> 'unit_price')::numeric,
      round((v_line ->> 'unit_price')::numeric * (v_line ->> 'quantity')::numeric, 2))
    returning id into v_line_id;

    if v_line ->> 'sale_mode' = 'perfume_formulation' then
      v_details := v_line -> 'details';
      insert into public.perfume_sale_line_details (
        sale_line_id, bottle_size_id, bottle_size_name, bottle_volume_ml,
        oil_type_id, oil_type_name, consumption_rule_id, grams_per_bottle,
        bottles_total, oil_grams_total)
      values (
        v_line_id, (v_details ->> 'bottle_size_id')::bigint, v_details ->> 'bottle_size_name',
        (v_details ->> 'bottle_volume_ml')::numeric, (v_details ->> 'oil_type_id')::bigint,
        v_details ->> 'oil_type_name', (v_details ->> 'consumption_rule_id')::bigint,
        (v_details ->> 'grams_per_bottle')::numeric, (v_line ->> 'quantity')::numeric,
        (v_details ->> 'grams_per_bottle')::numeric * (v_line ->> 'quantity')::numeric);
    end if;

    for v_comp in select value from jsonb_array_elements(v_line -> 'components') loop
      v_comp_total := (v_comp ->> 'quantity_per_unit')::numeric * (v_line ->> 'quantity')::numeric;

      insert into public.inventory_movements (
        item_id, quantity, unit, movement_type, reference_type, reference_id, metadata, created_by)
      select (v_comp ->> 'item_id')::bigint, -v_comp_total, i.unit, 'sale', 'sale', v_sale_id,
             jsonb_build_object('sale_line_id', v_line_id, 'source', v_comp ->> 'source',
                                'source_id', (v_comp ->> 'source_id')::bigint), v_uid
      from public.inventory_items i where i.id = (v_comp ->> 'item_id')::bigint
      returning id into v_movement_id;

      insert into public.sale_line_components (
        sale_line_id, inventory_item_id, item_name, unit, quantity_per_unit, quantity_total,
        source, source_id, movement_id)
      select v_line_id, i.id, i.name, i.unit, (v_comp ->> 'quantity_per_unit')::numeric, v_comp_total,
             v_comp ->> 'source', (v_comp ->> 'source_id')::bigint, v_movement_id
      from public.inventory_items i where i.id = (v_comp ->> 'item_id')::bigint;
    end loop;
  end loop;

  return jsonb_build_object('sale_id', v_sale_id, 'total', v_total, 'duplicate', false);
end;
$$;

comment on function public.sales_create_sale(uuid, jsonb, text, text) is
  'Atomic, idempotent sale creation. The only supported write path for sales and sale stock movements.';

-- ─── Cancel sale (RPC) ──────────────────────────────────────────────────────
-- Never deletes: adds one reversal movement per original sale movement.
create or replace function public.sales_cancel_sale(p_sale_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale  public.sales%rowtype;
  v_mv    record;
  v_count integer := 0;
begin
  perform public.require_role('admin', 'manager');
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'سبب الإلغاء مطلوب' using errcode = 'P0001', hint = 'REASON_REQUIRED';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'الفاتورة غير موجودة' using errcode = 'P0001', hint = 'SALE_NOT_FOUND';
  end if;
  if v_sale.status = 'cancelled' then
    raise exception 'الفاتورة ملغاة بالفعل' using errcode = 'P0001', hint = 'ALREADY_CANCELLED';
  end if;

  for v_mv in
    select m.id, m.item_id, m.quantity, m.unit
    from public.sale_line_components c
    join public.sale_lines l on l.id = c.sale_line_id
    join public.inventory_movements m on m.id = c.movement_id
    where l.sale_id = p_sale_id
    order by m.item_id, m.id
  loop
    insert into public.inventory_movements (
      item_id, quantity, unit, movement_type, reference_type, reference_id,
      reverses_movement_id, note)
    values (v_mv.item_id, -v_mv.quantity, v_mv.unit, 'reversal', 'sale', p_sale_id,
            v_mv.id, btrim(p_reason));
    v_count := v_count + 1;
  end loop;

  update public.sales
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = btrim(p_reason)
   where id = p_sale_id;

  return jsonb_build_object('sale_id', p_sale_id, 'reversed_movements', v_count);
end;
$$;
