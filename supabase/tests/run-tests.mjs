// Database test suite: applies every migration + seed to a throwaway local
// PostgreSQL 17 instance and verifies the business rules, RLS and the
// transactional sales engine (including real concurrent connections).
//
//   cd supabase/tests && npm install && npm test
//
// Supabase-specific pieces (auth schema, auth.uid(), anon/authenticated roles,
// default grants) are emulated by tiny stubs below; nothing touches any
// remote project.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PORT = 54329;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perfume-pg-'));

const db = new EmbeddedPostgres({
  databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PORT, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {}, onError: () => {},
});
const connect = async () => {
  const c = new pg.Client({ host: 'localhost', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  c.on('error', () => {});
  await c.connect();
  return c;
};

// ─── Supabase emulation ─────────────────────────────────────────────────────
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant anon, authenticated, service_role to postgres;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                           (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase's default: new objects in public are granted to the API roles
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

// ─── Tiny test framework ────────────────────────────────────────────────────
let passed = 0; const failures = [];
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✔ ${name}`); }
  catch (e) { failures.push({ name, e }); console.log(`  ✘ ${name}\n      ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => assert(String(a) === String(b), `${msg}: expected ${b}, got ${a}`);
const rejects = async (p, hintOrCode, msg) => {
  try { await p; } catch (e) {
    const got = e.hint ?? e.code;
    assert(got === hintOrCode || e.code === hintOrCode, `${msg}: expected ${hintOrCode}, got ${got} (${e.message})`);
    return e;
  }
  throw new Error(`${msg}: expected failure ${hintOrCode}, but it succeeded`);
};

const USERS = {
  admin:    { id: randomUUID(), email: 'admin@example.test',    role: 'admin',   active: true },
  manager:  { id: randomUUID(), email: 'manager@example.test',  role: 'manager', active: true },
  seller:   { id: randomUUID(), email: 'seller@example.test',   role: 'seller',  active: true },
  seller2:  { id: randomUUID(), email: 'seller2@example.test',  role: 'seller',  active: true },
  inactive: { id: randomUUID(), email: 'inactive@example.test', role: 'seller',  active: false },
};

// Run fn inside a transaction as the given app user (or anon). Commits unless rollback=true.
async function as(client, who, fn, { rollback = false } = {}) {
  await client.query('begin');
  try {
    if (who === 'anon') {
      await client.query(`set local role anon`);
    } else {
      await client.query(`set local role authenticated`);
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USERS[who].id]);
    }
    const r = await fn((sql, params) => client.query(sql, params));
    await client.query(rollback ? 'rollback' : 'commit');
    return r;
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

async function main() {
  await db.initialise();
  await db.start();
  const c = await connect();

  // lookups as superuser
  const one = async (sql, params) => (await c.query(sql, params)).rows[0];
  const val = async (sql, params) => Object.values(await one(sql, params))[0];
  const bal = (itemId) => val(`select quantity from public.inventory_balances where item_id = $1`, [itemId]);

  console.log('\n▸ Applying migrations');
  await c.query(SUPABASE_STUB);
  const migDir = path.join(root, 'migrations');
  for (const f of fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
    await c.query(fs.readFileSync(path.join(migDir, f), 'utf8'));
    console.log(`  ✔ ${f}`);
  }
  await c.query(fs.readFileSync(path.join(root, 'seed.sql'), 'utf8'));
  console.log('  ✔ seed.sql');

  // users: sign-up trigger creates inactive rows; then promote
  for (const u of Object.values(USERS)) {
    await c.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [u.id, u.email, { full_name: u.email.split('@')[0] }]);
  }
  await test('sign-up trigger creates an inactive seller row', async () => {
    const r = await one(`select role, active, full_name from public.app_users where id = $1`, [USERS.admin.id]);
    eq(r.role, 'seller', 'default role'); eq(r.active, false, 'default active'); eq(r.full_name, 'admin', 'full_name');
  });
  for (const u of Object.values(USERS)) {
    await c.query(`update public.app_users set role = $2, active = $3 where id = $1`, [u.id, u.role, u.active]);
  }

  // ids used by tests
  const size = async (ml) => one(`select * from public.bottle_sizes where volume_ml = $1`, [ml]);
  const oil = async (name) => one(`select * from public.oil_types where name = $1`, [name]);
  const product = async (sku) => one(`select * from public.products where sku = $1`, [sku]);
  const s100 = await size(100), s500 = await size(500), s200 = await size(200), s30 = await size(30);
  const french = await oil('فرنسي'), economy = await oil('اقتصادي'), conc = await oil('مركز');
  const blue = await product('PF-BLUE'), oud = await product('PF-OUD'), musk = await product('PF-MUSK'), gift = await product('ACC-GIFT');

  const sell = (q, lines, key = randomUUID()) =>
    q(`select public.sales_create_sale($1, $2::jsonb) as r`, [key, JSON.stringify(lines)]).then(r => r.rows[0].r);
  const perfumeLine = (p, s, o, quantity = 1, extra = {}) =>
    ({ product_id: p.id, bottle_size_id: s.id, oil_type_id: o.id, quantity, ...extra });

  console.log('\n▸ Security / RLS');
  await test('anon cannot read products', async () => {
    await rejects(as(c, 'anon', q => q(`select * from public.products`)), '42501', 'anon select');
  });
  await test('anon cannot call the sale RPC', async () => {
    await rejects(as(c, 'anon', q => sell(q, [perfumeLine(blue, s100, french)])), '42501', 'anon rpc');
  });
  await test('inactive user sees no data and cannot sell', async () => {
    const r = await as(c, 'inactive', q => q(`select count(*)::int n from public.products`));
    eq(r.rows[0].n, 0, 'visible products');
    await rejects(as(c, 'inactive', q => sell(q, [perfumeLine(blue, s100, french)])), 'FORBIDDEN', 'inactive sale');
  });
  await test('seller cannot create categories', async () => {
    await rejects(as(c, 'seller', q => q(`insert into public.categories (name) values ('x')`)), '42501', 'seller insert');
  });
  await test('seller cannot change consumption rules', async () => {
    const r = await as(c, 'seller', q => q(`update public.oil_consumption_rules set grams_per_bottle = 1`));
    eq(r.rowCount, 0, 'rows updated by seller');
  });
  await test('nobody can write the ledger or balances directly', async () => {
    const item = french.inventory_item_id;
    await rejects(as(c, 'admin', q => q(`insert into public.inventory_movements (item_id, quantity, unit, movement_type)
                                         values ($1, 100, 'g', 'receipt')`, [item])), '42501', 'admin insert movement');
    await rejects(as(c, 'admin', q => q(`update public.inventory_balances set quantity = 999999 where item_id = $1`, [item])),
      '42501', 'admin update balance');
    await rejects(as(c, 'seller', q => q(`insert into public.sales (idempotency_key, total) values (gen_random_uuid(), 0)`)),
      '42501', 'seller insert sale');
  });
  await test('ledger rows are immutable even for the database owner', async () => {
    await rejects(c.query(`update public.inventory_movements set quantity = 1 where id = (select min(id) from public.inventory_movements)`),
      'LEDGER_IMMUTABLE', 'owner update');
    await rejects(c.query(`delete from public.inventory_movements where id = (select min(id) from public.inventory_movements)`),
      'LEDGER_IMMUTABLE', 'owner delete');
  });
  await test('internal resolver is not callable by clients', async () => {
    await rejects(as(c, 'admin', q => q(`select public.perfume_resolve_line(1,1,1)`)), '42501', 'resolver');
  });
  await test('the last active admin cannot be demoted', async () => {
    await rejects(as(c, 'admin', q => q(`update public.app_users set role = 'seller' where id = $1`, [USERS.admin.id])),
      'LAST_ADMIN', 'demote last admin');
  });

  await test('user_directory exposes names only to active users', async () => {
    const r = await as(c, 'seller', q => q(`select * from public.user_directory`));
    eq(r.rows.length, Object.values(USERS).length, 'rows for active seller');
    assert(!('role' in r.rows[0]) && !('email' in r.rows[0]), 'no role/email columns');
    eq((await as(c, 'inactive', q => q(`select * from public.user_directory`))).rows.length, 0, 'rows for inactive user');
    await rejects(as(c, 'anon', q => q(`select * from public.user_directory`)), '42501', 'anon');
  });
  await test('product restrictions are replaced atomically and only by managers/admins', async () => {
    const rose = await product('PF-ROSE');
    await as(c, 'manager', q => q(`select public.perfume_set_product_restrictions($1, $2, $3)`, [rose.id, [s30.id, s100.id], [french.id]]));
    eq(await val(`select count(*) from public.perfume_product_bottle_sizes where product_id = $1`, [rose.id]), 2, 'sizes');
    eq(await val(`select count(*) from public.perfume_product_oil_types where product_id = $1`, [rose.id]), 1, 'oils');
    await rejects(as(c, 'seller', q => q(`select public.perfume_set_product_restrictions($1, $2, $3)`, [rose.id, [], []])), '42501', 'seller');
    eq(await val(`select count(*) from public.perfume_product_bottle_sizes where product_id = $1`, [rose.id]), 2, 'unchanged after seller attempt');
    await as(c, 'manager', q => q(`select public.perfume_set_product_restrictions($1, '{}', '{}')`, [rose.id]));
    eq(await val(`select count(*) from public.perfume_product_bottle_sizes where product_id = $1`, [rose.id]), 0, 'cleared');
  });

  console.log('\n▸ Sale options for the UI');
  await test('perfume_sale_options reports missing rules, prices and restrictions', async () => {
    const opts = (await as(c, 'seller', q => q(`select * from public.perfume_sale_options($1)`, [blue.id]))).rows;
    eq(opts.length, 21, 'combos for 7 sizes × 3 oils');
    const st = (s, o) => opts.find(x => x.bottle_size_id == s.id && x.oil_type_id == o.id).status;
    eq(st(s100, french), 'ok', 'french 100');
    eq(st(s500, economy), 'missing_rule', 'economy 500');
    eq(st(s200, conc), 'missing_price', 'concentrated 200');
    const mOpts = (await as(c, 'seller', q => q(`select * from public.perfume_sale_options($1)`, [musk.id]))).rows;
    eq(mOpts.find(x => x.bottle_size_id == s200.id && x.oil_type_id == french.id).status, 'not_allowed', 'musk 200');
    const oudOpt = (await as(c, 'seller', q => q(`select * from public.perfume_sale_options($1)`, [oud.id]))).rows
      .find(x => x.bottle_size_id == s100.id && x.oil_type_id == french.id);
    eq(oudOpt.unit_price, '400.00', 'product price override');
  });

  console.log('\n▸ Sales engine');
  let firstSaleId;
  await test('selling 1 bottle deducts exactly the configured oil grams and 1 bottle', async () => {
    const oilBefore = Number(await bal(french.inventory_item_id));
    const botBefore = Number(await bal(s100.inventory_item_id));
    const r = await as(c, 'seller', q => sell(q, [perfumeLine(blue, s100, french)]));
    firstSaleId = r.sale_id;
    eq(r.duplicate, false, 'duplicate flag'); eq(r.total, 320, 'total');
    eq(Number(await bal(french.inventory_item_id)), oilBefore - 30, 'oil balance');
    eq(Number(await bal(s100.inventory_item_id)), botBefore - 1, 'bottle balance');
    const d = await one(`select d.* from public.perfume_sale_line_details d join public.sale_lines l on l.id = d.sale_line_id where l.sale_id = $1`, [r.sale_id]);
    eq(d.grams_per_bottle, '30.000', 'snapshot grams'); eq(d.oil_grams_total, '30.000', 'total grams'); eq(d.bottles_total, '1.000', 'bottles');
    eq(await val(`select count(*) from public.inventory_movements where reference_type = 'sale' and reference_id = $1`, [r.sale_id]), 2, 'movements');
  });
  await test('multiple bottles + product price override + stock_item line in one sale', async () => {
    const oilBefore = Number(await bal(french.inventory_item_id));
    const giftBefore = Number(await bal(gift.inventory_item_id));
    const r = await as(c, 'seller', q => sell(q, [perfumeLine(oud, s100, french, 3), { product_id: gift.id, quantity: 2 }]));
    eq(r.total, 1300, 'total (3×400 + 2×50)');
    eq(Number(await bal(french.inventory_item_id)), oilBefore - 90, 'oil −90 g');
    eq(Number(await bal(gift.inventory_item_id)), giftBefore - 2, 'gift boxes −2');
  });
  await test('retrying with the same idempotency key does not deduct twice', async () => {
    const key = randomUUID();
    const before = Number(await bal(french.inventory_item_id));
    const a = await as(c, 'seller', q => sell(q, [perfumeLine(blue, s30, french)], key));
    const b = await as(c, 'seller', q => sell(q, [perfumeLine(blue, s30, french)], key));
    eq(b.duplicate, true, 'second call flagged duplicate'); eq(b.sale_id, a.sale_id, 'same sale');
    eq(Number(await bal(french.inventory_item_id)), before - 9, 'deducted once');
    await rejects(as(c, 'seller2', q => sell(q, [perfumeLine(blue, s30, french)], key)), 'IDEMPOTENCY_CONFLICT', 'other user, same key');
  });
  await test('missing consumption rule is rejected with a clear error', async () => {
    const e = await rejects(as(c, 'seller', q => sell(q, [perfumeLine(blue, s500, economy)])), 'MISSING_CONSUMPTION_RULE', 'missing rule');
    assert(e.message.includes('اقتصادي') && e.message.includes('500'), 'message names the combination');
  });
  await test('missing price is rejected', async () => {
    await rejects(as(c, 'seller', q => sell(q, [perfumeLine(blue, s200, conc)])), 'MISSING_PRICE', 'missing price');
  });
  await test('product size restriction is enforced', async () => {
    await rejects(as(c, 'seller', q => sell(q, [perfumeLine(musk, s200, french)])), 'SIZE_NOT_ALLOWED', 'musk 200');
  });
  await test('fractional bottles and non-positive quantities are rejected', async () => {
    await rejects(as(c, 'seller', q => sell(q, [perfumeLine(blue, s100, french, 1.5)])), 'INVALID_QUANTITY', '1.5 bottles');
    await rejects(as(c, 'seller', q => sell(q, [perfumeLine(blue, s100, french, 0)])), 'INVALID_QUANTITY', '0 bottles');
  });
  await test('insufficient stock rejects the whole sale (no partial writes)', async () => {
    const sales = await val(`select count(*) from public.sales`);
    const movs = await val(`select count(*) from public.inventory_movements`);
    const oilBefore = await bal(french.inventory_item_id);
    // line 1 is fine, line 2 needs 6 × 500 ml bottles but only 5 exist
    const e = await rejects(as(c, 'seller', q => sell(q, [perfumeLine(blue, s100, french), perfumeLine(blue, s500, french, 6)])),
      'INSUFFICIENT_STOCK', 'oversell');
    assert(e.message.includes('500'), 'message names the short item');
    eq(await val(`select count(*) from public.sales`), sales, 'sales count unchanged');
    eq(await val(`select count(*) from public.inventory_movements`), movs, 'movement count unchanged');
    eq(await bal(french.inventory_item_id), oilBefore, 'oil unchanged');
  });
  await test('seller cannot override price; manager can', async () => {
    await rejects(as(c, 'seller', q => sell(q, [perfumeLine(blue, s30, french, 1, { unit_price: 1 })])), 'PRICE_OVERRIDE_FORBIDDEN', 'seller override');
    const r = await as(c, 'manager', q => sell(q, [perfumeLine(blue, s30, french, 1, { unit_price: 99.5 })]));
    eq(r.total, 99.5, 'manager override total');
    const l = await one(`select list_unit_price, unit_price from public.sale_lines where sale_id = $1`, [r.sale_id]);
    eq(l.list_unit_price, '120.00', 'list price kept'); eq(l.unit_price, '99.50', 'actual price');
  });
  await test('changing a rule later does not change historical quantities', async () => {
    await as(c, 'admin', q => q(`update public.oil_consumption_rules set grams_per_bottle = 35 where oil_type_id = $1 and bottle_size_id = $2`, [french.id, s100.id]));
    const old = await one(`select d.grams_per_bottle, m.quantity from public.perfume_sale_line_details d
      join public.sale_lines l on l.id = d.sale_line_id
      join public.sale_line_components sc on sc.sale_line_id = l.id and sc.source = 'oil_consumption_rule'
      join public.inventory_movements m on m.id = sc.movement_id where l.sale_id = $1`, [firstSaleId]);
    eq(old.grams_per_bottle, '30.000', 'old snapshot'); eq(old.quantity, '-30.000', 'old movement');
    const before = Number(await bal(french.inventory_item_id));
    await as(c, 'seller', q => sell(q, [perfumeLine(blue, s100, french)]));
    eq(Number(await bal(french.inventory_item_id)), before - 35, 'new rule applied to new sale');
  });
  await test('seller sees only own sales; manager sees all', async () => {
    const mine = (await as(c, 'seller', q => q(`select count(*)::int n from public.sales`))).rows[0].n;
    const all = (await as(c, 'manager', q => q(`select count(*)::int n from public.sales`))).rows[0].n;
    const sellerOwn = await val(`select count(*)::int from public.sales where created_by = $1`, [USERS.seller.id]);
    eq(mine, sellerOwn, 'seller visible'); assert(all > mine, 'manager sees more');
  });

  console.log('\n▸ Cancellation');
  await test('cancel creates reversal movements and restores stock', async () => {
    const oilBefore = Number(await bal(french.inventory_item_id));
    const botBefore = Number(await bal(s100.inventory_item_id));
    await rejects(as(c, 'seller', q => q(`select public.sales_cancel_sale($1, 'x')`, [firstSaleId])), 'FORBIDDEN', 'seller cancel');
    await rejects(as(c, 'manager', q => q(`select public.sales_cancel_sale($1, ' ')`, [firstSaleId])), 'REASON_REQUIRED', 'empty reason');
    const r = await as(c, 'manager', q => q(`select public.sales_cancel_sale($1, 'خطأ في الطلب') r`, [firstSaleId]));
    eq(r.rows[0].r.reversed_movements, 2, 'reversals');
    eq(Number(await bal(french.inventory_item_id)), oilBefore + 30, 'oil restored with ORIGINAL 30 g');
    eq(Number(await bal(s100.inventory_item_id)), botBefore + 1, 'bottle restored');
    eq(await val(`select status from public.sales where id = $1`, [firstSaleId]), 'cancelled', 'status');
    await rejects(as(c, 'manager', q => q(`select public.sales_cancel_sale($1, 'again')`, [firstSaleId])), 'ALREADY_CANCELLED', 'double cancel');
  });
  await test('sale rows cannot be edited or deleted', async () => {
    await rejects(c.query(`update public.sales set total = 0 where id = $1`, [firstSaleId]), 'SALE_IMMUTABLE', 'edit total');
    await rejects(c.query(`delete from public.sale_lines where sale_id = $1`, [firstSaleId]), 'SALE_IMMUTABLE', 'delete line');
  });

  console.log('\n▸ Concurrency (two real connections)');
  await test('concurrent sales cannot oversell the last bottles', async () => {
    const left = Number(await bal(s500.inventory_item_id));   // 5
    const a = await connect(), b = await connect();
    try {
      await a.query('begin; set local role authenticated');
      await a.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USERS.seller.id]);
      await a.query(`select public.sales_create_sale($1, $2::jsonb)`, [randomUUID(), JSON.stringify([perfumeLine(blue, s500, french, left - 1)])]);
      // B wants 2 bottles while A (holding the lock) has taken all but 1
      let bDone = false;
      const bPromise = as(b, 'seller2', q => sell(q, [perfumeLine(blue, s500, french, 2)])).finally(() => { bDone = true; });
      await new Promise(r => setTimeout(r, 700));
      assert(!bDone, 'B must wait for A\'s row lock');
      await a.query('commit');
      await rejects(bPromise, 'INSUFFICIENT_STOCK', 'B after A commits');
      eq(Number(await bal(s500.inventory_item_id)), 1, 'one bottle left, never negative');
    } finally { await a.end(); await b.end(); }
  });
  await test('concurrent duplicate submissions with the same key create one sale', async () => {
    const key = randomUUID();
    const before = Number(await bal(s30.inventory_item_id));
    const a = await connect(), b = await connect();
    try {
      await a.query('begin; set local role authenticated');
      await a.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USERS.seller.id]);
      await a.query(`select public.sales_create_sale($1, $2::jsonb)`, [key, JSON.stringify([perfumeLine(blue, s30, french)])]);
      const bPromise = as(b, 'seller', q => sell(q, [perfumeLine(blue, s30, french)], key));
      await new Promise(r => setTimeout(r, 500));
      await a.query('commit');
      const r = await bPromise;
      eq(r.duplicate, true, 'second request is a duplicate');
      eq(Number(await bal(s30.inventory_item_id)), before - 1, 'one bottle deducted');
      eq(await val(`select count(*) from public.sales where idempotency_key = $1`, [key]), 1, 'one sale row');
    } finally { await a.end(); await b.end(); }
  });

  console.log('\n▸ Inventory operations');
  await test('receive / adjust / stocktake go through the ledger', async () => {
    const item = economy.inventory_item_id;
    const start = Number(await bal(item));
    await as(c, 'manager', q => q(`select public.inventory_receive($1, 1000, 'شحنة')`, [item]));
    await as(c, 'manager', q => q(`select public.inventory_adjust($1, -50, 'انسكاب', 'waste')`, [item]));
    eq(Number(await bal(item)), start + 950, 'after receipt and waste');
    await as(c, 'manager', q => q(`select public.inventory_record_count($1, 7000, 'جرد')`, [item]));
    eq(Number(await bal(item)), 7000, 'after stocktake');
    const m = await one(`select quantity, metadata from public.inventory_movements where item_id = $1 order by id desc limit 1`, [item]);
    eq(Number(m.quantity), 7000 - (start + 950), 'stocktake delta'); eq(m.metadata.counted_quantity, 7000, 'counted stored');
    await rejects(as(c, 'seller', q => q(`select public.inventory_receive($1, 10)`, [item])), 'FORBIDDEN', 'seller receive');
    await rejects(as(c, 'manager', q => q(`select public.inventory_adjust($1, -1, '')`, [item])), 'REASON_REQUIRED', 'no reason');
  });
  await test('negative stock allowed only when the admin setting is on', async () => {
    await as(c, 'admin', q => q(`update public.app_settings set value = 'true' where key = 'inventory.allow_negative_stock'`));
    await as(c, 'seller', q => sell(q, [perfumeLine(blue, s500, french, 3)]));
    eq(Number(await bal(s500.inventory_item_id)), -2, 'went negative by policy');
    await as(c, 'admin', q => q(`update public.app_settings set value = 'false' where key = 'inventory.allow_negative_stock'`));
    await rejects(as(c, 'seller', q => sell(q, [perfumeLine(blue, s500, french, 1)])), 'INSUFFICIENT_STOCK', 'blocked again');
    await as(c, 'manager', q => q(`select public.inventory_receive($1, 10)`, [s500.inventory_item_id]));
  });
  await test('every balance equals the sum of its ledger movements', async () => {
    const bad = await val(`select count(*) from public.inventory_balances b
      where b.quantity <> coalesce((select sum(m.quantity) from public.inventory_movements m where m.item_id = b.item_id), 0)`);
    eq(bad, 0, 'items with drift');
  });
  await test('adding a new bottle size / oil type needs no schema change', async () => {
    await as(c, 'admin', async q => {
      const s = (await q(`insert into public.bottle_sizes (name, volume_ml) values ('75 مل', 75) returning *`)).rows[0];
      const o = (await q(`insert into public.oil_types (name) values ('عربي') returning *`)).rows[0];
      await q(`insert into public.oil_consumption_rules (oil_type_id, bottle_size_id, grams_per_bottle) values ($1, $2, 20)`, [o.id, s.id]);
      await q(`insert into public.perfume_prices (bottle_size_id, oil_type_id, price) values ($1, $2, 200)`, [s.id, o.id]);
      const unit = (await q(`select unit from public.inventory_items where id = $1`, [o.inventory_item_id])).rows[0].unit;
      eq(unit, 'g', 'new oil stocked in grams');
    });
    const s75 = await size(75);
    await rejects(as(c, 'admin', q => q(`insert into public.oil_consumption_rules (oil_type_id, bottle_size_id, grams_per_bottle)
                                 values ($1, $2, 0)`, [french.id, s75.id])), '23514', 'zero grams rejected by CHECK');
    await rejects(as(c, 'admin', q => q(`insert into public.oil_consumption_rules (oil_type_id, bottle_size_id, grams_per_bottle)
                                 values ($1, $2, 5)`, [french.id, s100.id])), '23505', 'duplicate combo rejected');
  });

  console.log('\n▸ Reports');
  await test('reports are consistent with recorded sales and ledger', async () => {
    const from = '2000-01-01', to = '2100-01-01';
    const days = (await as(c, 'manager', q => q(`select * from public.report_sales_by($1, $2, 'day')`, [from, to]))).rows;
    const byProduct = (await as(c, 'manager', q => q(`select * from public.report_sales_by($1, $2, 'product')`, [from, to]))).rows;
    const bySize = (await as(c, 'manager', q => q(`select * from public.report_sales_by($1, $2, 'bottle_size')`, [from, to]))).rows;
    const byOil = (await as(c, 'manager', q => q(`select * from public.report_sales_by($1, $2, 'oil_type')`, [from, to]))).rows;
    const completed = Number(await val(`select sum(total) from public.sales where status = 'completed'`));
    const sum = rows => rows.reduce((a, r) => a + Number(r.revenue), 0);
    eq(sum(days).toFixed(2), completed.toFixed(2), 'by day = completed sales');
    eq(sum(byProduct).toFixed(2), completed.toFixed(2), 'by product = completed sales');
    const perfumeRevenue = Number(await val(`select sum(l.line_total) from public.sale_lines l join public.sales s on s.id = l.sale_id
                                            where s.status = 'completed' and l.sale_mode = 'perfume_formulation'`));
    eq(sum(bySize).toFixed(2), perfumeRevenue.toFixed(2), 'by size = perfume revenue');
    eq(sum(byOil).toFixed(2), perfumeRevenue.toFixed(2), 'by oil = perfume revenue');
    const cons = (await as(c, 'manager', q => q(`select * from public.report_stock_consumption($1, $2, 'raw_material')`, [from, to]))).rows;
    const frenchCons = cons.find(r => r.oil_type_name === 'فرنسي');
    const ledgerNet = -Number(await val(`select sum(quantity) from public.inventory_movements where item_id = $1 and reference_type = 'sale'`, [french.inventory_item_id]));
    eq(Number(frenchCons.net_consumed), ledgerNet, 'oil consumption = ledger');
    const gramsFromLines = Number(byOil.find(r => r.label === 'فرنسي').oil_grams);
    eq(Number(frenchCons.net_consumed), gramsFromLines, 'ledger grams = sale line grams');
  });
  await test('dashboard summary works for a seller', async () => {
    const r = (await as(c, 'seller', q => q(`select public.dashboard_summary() s`))).rows[0].s;
    assert(r.sales_today >= 1, 'sales today');
    eq(r.missing_rules, await val(`select count(*) from public.v_perfume_config_matrix where missing_rule`), 'missing rules');
  });

  await c.end();
}

try {
  await main();
} catch (e) {
  failures.push({ name: 'setup', e });
  console.error(e);
} finally {
  await db.stop().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
