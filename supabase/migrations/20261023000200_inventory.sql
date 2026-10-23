-- ════════════════════════════════════════════════════════════════════════════
-- 0200 — Reusable inventory module
--   inventory_items      : anything physically tracked in stock
--   inventory_movements  : append-only ledger (source of truth)
--   inventory_balances   : running balance per item, maintained ONLY by the
--                          ledger trigger inside the same transaction
-- Nothing here knows about perfumes; perfume config links to items by FK.
-- ════════════════════════════════════════════════════════════════════════════

create table public.inventory_items (
  id             bigint generated always as identity primary key,
  name           text not null check (btrim(name) <> ''),
  sku            text unique check (sku is null or btrim(sku) <> ''),
  -- Stock unit. Oil is stocked in grams because consumption rules are in grams.
  -- g and ml are NOT interchangeable; converting requires an explicit density.
  unit           text not null check (unit in ('g', 'pcs', 'ml')),
  item_group     text not null default 'other'
                   check (item_group in ('raw_material', 'packaging', 'merchandise', 'other')),
  reorder_level  numeric(14, 3) not null default 0 check (reorder_level >= 0),
  active         boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index inventory_items_name_key on public.inventory_items (lower(btrim(name)));
create index inventory_items_group_idx on public.inventory_items (item_group) where active;

create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

create trigger inventory_items_audit
  after insert or update or delete on public.inventory_items
  for each row execute function public.audit_row_change('id');

-- Unit is immutable once the item has movements (it would corrupt history).
create or replace function public.inventory_items_guard_unit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.unit <> old.unit
     and exists (select 1 from public.inventory_movements m where m.item_id = old.id) then
    raise exception 'لا يمكن تغيير وحدة صنف له حركات مخزون'
      using errcode = 'P0001', hint = 'UNIT_LOCKED';
  end if;
  return new;
end;
$$;

-- ─── Balances ───────────────────────────────────────────────────────────────
create table public.inventory_balances (
  item_id           bigint primary key references public.inventory_items (id) on delete cascade,
  quantity          numeric(14, 3) not null default 0,
  last_movement_at  timestamptz,
  updated_at        timestamptz not null default now()
);

comment on table public.inventory_balances is
  'Theoretical (book) stock = SUM(inventory_movements.quantity). Written only by the movement trigger. '
  'Not a verified physical count; physical counts are recorded as stocktake movements.';

create or replace function public.inventory_items_create_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory_balances (item_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger inventory_items_create_balance
  after insert on public.inventory_items
  for each row execute function public.inventory_items_create_balance();

-- ─── Movement ledger ────────────────────────────────────────────────────────
create table public.inventory_movements (
  id                    bigint generated always as identity primary key,
  item_id               bigint not null references public.inventory_items (id) on delete restrict,
  -- signed delta in the item's unit: + adds stock, - removes stock
  quantity              numeric(14, 3) not null check (quantity <> 0),
  unit                  text not null check (unit in ('g', 'pcs', 'ml')),
  movement_type         text not null check (movement_type in (
                          'opening',     -- initial balance
                          'receipt',     -- purchase / goods received
                          'sale',        -- consumed by a sale
                          'reversal',    -- reverses another movement (cancellation / return)
                          'adjustment',  -- manual correction with a reason
                          'waste',       -- damaged / spilled / broken
                          'stocktake'    -- physical count difference
                        )),
  reference_type        text,          -- e.g. 'sale', 'sale_line_component'
  reference_id          bigint,
  reverses_movement_id  bigint references public.inventory_movements (id) on delete restrict,
  balance_after         numeric(14, 3) not null,
  note                  text,
  metadata              jsonb not null default '{}'::jsonb,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  constraint inventory_movements_reversal_link
    check ((movement_type = 'reversal') = (reverses_movement_id is not null))
);

comment on table public.inventory_movements is
  'Append-only stock ledger. Rows are never updated or deleted; mistakes are fixed with reversal/adjustment movements.';

create index inventory_movements_item_created_idx on public.inventory_movements (item_id, created_at desc);
create index inventory_movements_created_idx      on public.inventory_movements (created_at desc);
create index inventory_movements_reference_idx    on public.inventory_movements (reference_type, reference_id);
create index inventory_movements_type_created_idx on public.inventory_movements (movement_type, created_at);
create index inventory_movements_reverses_idx     on public.inventory_movements (reverses_movement_id)
  where reverses_movement_id is not null;

create trigger inventory_items_guard_unit
  before update of unit on public.inventory_items
  for each row execute function public.inventory_items_guard_unit();

-- Applies the movement to the balance under a row lock. Concurrent writers on
-- the same item serialize on the balance row, so the negative-stock check
-- always sees the latest committed quantity.
create or replace function public.inventory_movements_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_unit text;
  v_after     numeric(14, 3);
begin
  select i.unit into v_item_unit from public.inventory_items i where i.id = new.item_id;
  if v_item_unit is null then
    raise exception 'صنف المخزون غير موجود' using errcode = 'P0001', hint = 'ITEM_NOT_FOUND';
  end if;

  new.unit := coalesce(new.unit, v_item_unit);
  if new.unit <> v_item_unit then
    raise exception 'وحدة الحركة (%) لا تطابق وحدة الصنف (%)', new.unit, v_item_unit
      using errcode = 'P0001', hint = 'UNIT_MISMATCH';
  end if;

  update public.inventory_balances b
     set quantity = b.quantity + new.quantity,
         last_movement_at = now(),
         updated_at = now()
   where b.item_id = new.item_id
  returning b.quantity into v_after;

  if v_after is null then
    -- balance row missing (should not happen): create it under the same lock
    insert into public.inventory_balances (item_id, quantity, last_movement_at)
    values (new.item_id, new.quantity, now())
    returning quantity into v_after;
  end if;

  if new.quantity < 0 and v_after < 0
     and not public.setting_bool('inventory.allow_negative_stock', false) then
    raise exception 'الرصيد غير كافٍ للصنف رقم %', new.item_id
      using errcode = 'P0001', hint = 'INSUFFICIENT_STOCK';
  end if;

  new.balance_after := v_after;
  return new;
end;
$$;

create trigger inventory_movements_apply
  before insert on public.inventory_movements
  for each row execute function public.inventory_movements_apply();

create or replace function public.inventory_movements_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'حركات المخزون لا يمكن تعديلها أو حذفها؛ استخدم حركة عكسية أو تسوية'
    using errcode = 'P0001', hint = 'LEDGER_IMMUTABLE';
end;
$$;

create trigger inventory_movements_immutable
  before update or delete on public.inventory_movements
  for each row execute function public.inventory_movements_immutable();

-- Balances may only change through the ledger trigger above.
create or replace function public.inventory_balances_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() < 2 then
    raise exception 'الأرصدة تتغير فقط من خلال حركات المخزون'
      using errcode = 'P0001', hint = 'BALANCE_READ_ONLY';
  end if;
  return new;
end;
$$;

create trigger inventory_balances_guard
  before update on public.inventory_balances
  for each row execute function public.inventory_balances_guard();

-- ─── Manual stock operations (RPC) ──────────────────────────────────────────
-- Goods received.
create or replace function public.inventory_receive(
  p_item_id  bigint,
  p_quantity numeric,
  p_note     text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform public.require_role('admin', 'manager');
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'الكمية المستلمة يجب أن تكون أكبر من صفر' using errcode = 'P0001', hint = 'INVALID_QUANTITY';
  end if;
  if not exists (select 1 from public.inventory_items i where i.id = p_item_id and i.active) then
    raise exception 'الصنف غير موجود أو غير مفعّل' using errcode = 'P0001', hint = 'ITEM_INACTIVE';
  end if;

  insert into public.inventory_movements (item_id, quantity, unit, movement_type, note)
  select p_item_id, p_quantity, i.unit, 'receipt', nullif(btrim(p_note), '')
  from public.inventory_items i where i.id = p_item_id
  returning id into v_id;
  return v_id;
end;
$$;

-- Signed correction (adjustment) or loss (waste). A reason is mandatory.
create or replace function public.inventory_adjust(
  p_item_id       bigint,
  p_delta         numeric,
  p_reason        text,
  p_movement_type text default 'adjustment'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform public.require_role('admin', 'manager');
  if p_movement_type not in ('adjustment', 'waste') then
    raise exception 'نوع الحركة غير صالح' using errcode = 'P0001', hint = 'INVALID_TYPE';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'كمية التسوية يجب ألا تساوي صفر' using errcode = 'P0001', hint = 'INVALID_QUANTITY';
  end if;
  if p_movement_type = 'waste' and p_delta > 0 then
    raise exception 'التالف يجب أن يكون بالسالب' using errcode = 'P0001', hint = 'INVALID_QUANTITY';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'سبب التسوية مطلوب' using errcode = 'P0001', hint = 'REASON_REQUIRED';
  end if;

  insert into public.inventory_movements (item_id, quantity, unit, movement_type, note)
  select p_item_id, p_delta, i.unit, p_movement_type, btrim(p_reason)
  from public.inventory_items i where i.id = p_item_id
  returning id into v_id;
  if v_id is null then
    raise exception 'الصنف غير موجود' using errcode = 'P0001', hint = 'ITEM_NOT_FOUND';
  end if;
  return v_id;
end;
$$;

-- Physical count: records the difference between counted and book quantity.
-- Returns the movement id, or NULL when the count matches the book balance.
create or replace function public.inventory_record_count(
  p_item_id bigint,
  p_counted numeric,
  p_note    text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_book numeric(14, 3);
  v_id   bigint;
begin
  perform public.require_role('admin', 'manager');
  if p_counted is null or p_counted < 0 then
    raise exception 'الكمية الفعلية يجب أن تكون صفر أو أكثر' using errcode = 'P0001', hint = 'INVALID_QUANTITY';
  end if;

  select b.quantity into v_book
  from public.inventory_balances b
  where b.item_id = p_item_id
  for update;
  if not found then
    raise exception 'الصنف غير موجود' using errcode = 'P0001', hint = 'ITEM_NOT_FOUND';
  end if;

  if p_counted = v_book then
    return null;
  end if;

  insert into public.inventory_movements (item_id, quantity, unit, movement_type, note, metadata)
  select p_item_id, p_counted - v_book, i.unit, 'stocktake', nullif(btrim(p_note), ''),
         jsonb_build_object('book_quantity', v_book, 'counted_quantity', p_counted)
  from public.inventory_items i where i.id = p_item_id
  returning id into v_id;
  return v_id;
end;
$$;
