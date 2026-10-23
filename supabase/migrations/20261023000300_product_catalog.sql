-- ════════════════════════════════════════════════════════════════════════════
-- 0300 — Reusable product catalog
-- A product is what the customer buys. It is NOT necessarily a stocked unit:
--   sale_mode = 'stock_item'          → sells one linked inventory item per unit
--                                        at products.unit_price
--   sale_mode = 'perfume_formulation' → priced and resolved into components
--                                        (oil + bottle) by the perfume module
-- New sale modes are added by a new resolver in the sales engine, never by a
-- new products table.
-- ════════════════════════════════════════════════════════════════════════════

create table public.categories (
  id           bigint generated always as identity primary key,
  name         text not null check (btrim(name) <> ''),
  description  text,
  sort_order   integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index categories_name_key on public.categories (lower(btrim(name)));

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

create trigger categories_audit
  after insert or update or delete on public.categories
  for each row execute function public.audit_row_change('id');

create table public.products (
  id                 bigint generated always as identity primary key,
  category_id        bigint not null references public.categories (id) on delete restrict,
  name               text not null check (btrim(name) <> ''),
  sku                text unique check (sku is null or btrim(sku) <> ''),
  description        text,
  image_url          text check (image_url is null or image_url ~* '^https?://'),
  sale_mode          text not null default 'stock_item' check (sale_mode ~ '^[a-z][a-z_]*$'),
  -- only for sale_mode = 'stock_item'
  inventory_item_id  bigint references public.inventory_items (id) on delete restrict,
  unit_price         numeric(12, 2) check (unit_price is null or unit_price >= 0),
  sort_order         integer not null default 0,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint products_stock_item_complete check (
    sale_mode <> 'stock_item' or (inventory_item_id is not null and unit_price is not null)
  )
);

comment on column public.products.sale_mode is
  'How a sale line for this product is priced and which stock it consumes. Known modes: stock_item, perfume_formulation.';

create unique index products_category_name_key on public.products (category_id, lower(btrim(name)));
create index products_category_idx on public.products (category_id);
create index products_active_idx   on public.products (active, sort_order);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create trigger products_audit
  after insert or update or delete on public.products
  for each row execute function public.audit_row_change('id');
