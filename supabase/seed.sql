-- ════════════════════════════════════════════════════════════════════════════
-- DEVELOPMENT SEED DATA — do NOT run against production.
-- `supabase db reset` runs this automatically after the migrations.
-- Values are examples only; the real lists are managed from the admin UI.
-- Some oil/size combinations are intentionally left without a rule or price so
-- the "missing configuration" warnings can be seen and tested.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_perfumes  bigint;
  v_acc       bigint;
  v_gift_item bigint;
  v_musk      bigint;
  v_oud       bigint;
begin
  -- ─── Categories ───
  insert into public.categories (name, description, sort_order)
  values ('تركيبات', 'عطور يتم تركيبها عند البيع حسب الحجم ونوع الزيت', 1)
  returning id into v_perfumes;
  insert into public.categories (name, description, sort_order)
  values ('إكسسوارات', 'منتجات جاهزة تُباع بالقطعة', 2)
  returning id into v_acc;

  -- ─── Bottle sizes (each auto-creates its empty-bottle inventory item) ───
  insert into public.bottle_sizes (name, volume_ml, sort_order) values
    ('30 مل', 30, 1), ('50 مل', 50, 2), ('100 مل', 100, 3), ('150 مل', 150, 4),
    ('200 مل', 200, 5), ('250 مل', 250, 6), ('500 مل', 500, 7);

  -- ─── Oil types (each auto-creates its oil inventory item, in grams) ───
  insert into public.oil_types (name, description, sort_order) values
    ('فرنسي', 'زيت فرنسي عالي الجودة', 1),
    ('اقتصادي', 'زيت اقتصادي', 2),
    ('مركز', 'زيت مركز', 3);

  -- ─── Consumption rules (grams of oil per bottle) ───
  insert into public.oil_consumption_rules (oil_type_id, bottle_size_id, grams_per_bottle)
  select o.id, s.id, g.grams
  from (values
    ('فرنسي', 30, 9), ('فرنسي', 50, 15), ('فرنسي', 100, 30), ('فرنسي', 150, 45),
    ('فرنسي', 200, 60), ('فرنسي', 250, 75), ('فرنسي', 500, 150),
    ('اقتصادي', 30, 7), ('اقتصادي', 50, 12), ('اقتصادي', 100, 24), ('اقتصادي', 150, 36),
    ('اقتصادي', 200, 48), ('اقتصادي', 250, 60),                       -- 500 ml intentionally missing
    ('مركز', 30, 12), ('مركز', 50, 20), ('مركز', 100, 40), ('مركز', 150, 60),
    ('مركز', 200, 80)                                                   -- 250 / 500 ml intentionally missing
  ) as g(oil, ml, grams)
  join public.oil_types o on o.name = g.oil
  join public.bottle_sizes s on s.volume_ml = g.ml;

  -- ─── Default prices (product_id NULL) ───
  insert into public.perfume_prices (product_id, bottle_size_id, oil_type_id, price)
  select null, s.id, o.id, g.price
  from (values
    ('فرنسي', 30, 120), ('فرنسي', 50, 180), ('فرنسي', 100, 320), ('فرنسي', 150, 450),
    ('فرنسي', 200, 580), ('فرنسي', 250, 700), ('فرنسي', 500, 1300),
    ('اقتصادي', 30, 80), ('اقتصادي', 50, 120), ('اقتصادي', 100, 210), ('اقتصادي', 150, 300),
    ('اقتصادي', 200, 380), ('اقتصادي', 250, 460),
    ('مركز', 30, 150), ('مركز', 50, 230), ('مركز', 100, 420), ('مركز', 150, 600)
                                                                        -- مركز 200 ml: rule but no price
  ) as g(oil, ml, price)
  join public.oil_types o on o.name = g.oil
  join public.bottle_sizes s on s.volume_ml = g.ml;

  -- ─── Products ───
  insert into public.products (category_id, name, sku, description, sale_mode, sort_order) values
    (v_perfumes, 'عطر بلو',    'PF-BLUE', 'تركيبة بلو', 'perfume_formulation', 1),
    (v_perfumes, 'ورد طائفي',  'PF-ROSE', 'تركيبة ورد طائفي', 'perfume_formulation', 3);
  insert into public.products (category_id, name, sku, description, sale_mode, sort_order)
  values (v_perfumes, 'عود ملكي', 'PF-OUD', 'تركيبة عود — سعر خاص لبعض الأحجام', 'perfume_formulation', 2)
  returning id into v_oud;
  insert into public.products (category_id, name, sku, description, sale_mode, sort_order)
  values (v_perfumes, 'مسك أبيض', 'PF-MUSK', 'متاح بأحجام صغيرة فقط', 'perfume_formulation', 4)
  returning id into v_musk;

  -- product-specific price override
  insert into public.perfume_prices (product_id, bottle_size_id, oil_type_id, price)
  select v_oud, s.id, o.id, 400
  from public.bottle_sizes s, public.oil_types o
  where s.volume_ml = 100 and o.name = 'فرنسي';

  -- restriction: musk only in 30 / 50 / 100 ml
  insert into public.perfume_product_bottle_sizes (product_id, bottle_size_id)
  select v_musk, s.id from public.bottle_sizes s where s.volume_ml in (30, 50, 100);

  -- a ready-made product sold from its own stock item
  insert into public.inventory_items (name, sku, unit, item_group, reorder_level)
  values ('علبة هدايا فاخرة', 'ACC-GIFT', 'pcs', 'merchandise', 5)
  returning id into v_gift_item;
  insert into public.products (category_id, name, sku, sale_mode, inventory_item_id, unit_price)
  values (v_acc, 'علبة هدايا فاخرة', 'ACC-GIFT', 'stock_item', v_gift_item, 50);

  -- ─── Reorder levels ───
  update public.inventory_items i set reorder_level = 1000
  from public.oil_types o where o.inventory_item_id = i.id;
  update public.inventory_items i set reorder_level = 10
  from public.bottle_sizes s where s.inventory_item_id = i.id;

  -- ─── Opening stock (through the ledger, never by editing balances) ───
  insert into public.inventory_movements (item_id, quantity, unit, movement_type, note)
  select o.inventory_item_id, q.qty, 'g', 'opening', 'رصيد افتتاحي (بيانات تجريبية)'
  from (values ('فرنسي', 5000), ('اقتصادي', 8000), ('مركز', 1500)) q(oil, qty)
  join public.oil_types o on o.name = q.oil;

  insert into public.inventory_movements (item_id, quantity, unit, movement_type, note)
  select s.inventory_item_id, case when s.volume_ml = 500 then 5 else 50 end, 'pcs', 'opening',
         'رصيد افتتاحي (بيانات تجريبية)'
  from public.bottle_sizes s;

  insert into public.inventory_movements (item_id, quantity, unit, movement_type, note)
  values (v_gift_item, 20, 'pcs', 'opening', 'رصيد افتتاحي (بيانات تجريبية)');
end
$$;
