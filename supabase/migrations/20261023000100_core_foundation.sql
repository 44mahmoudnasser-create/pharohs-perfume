-- ════════════════════════════════════════════════════════════════════════════
-- 0100 — Reusable business core
--   • app_users  : database-backed authorization (role + active flag)
--   • app_settings: key/value business settings (typed via jsonb)
--   • audit_log  : generic row-change audit trail
--   • shared helper functions (updated_at trigger, role checks)
-- Nothing in this file is perfume-specific.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Users & roles ──────────────────────────────────────────────────────────
-- Roles:
--   admin   — full access, including configuration, users and settings
--   manager — catalog, inventory adjustments, sales, cancellations, reports
--   seller  — create sales and read data needed to sell
-- A user row is created automatically (inactive) when someone signs up in
-- Supabase Auth. An admin must activate it before the user can do anything.
create table public.app_users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'seller' check (role in ('admin', 'manager', 'seller')),
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.app_users is
  'Authorization source of truth. Never trust JWT/user_metadata role claims; always read role from here.';
comment on column public.app_users.active is
  'Inactive users are denied every business permission even if authenticated.';

-- ─── Generic updated_at trigger ─────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger app_users_set_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();

-- ─── Role helpers ───────────────────────────────────────────────────────────
-- SECURITY DEFINER so they can read app_users regardless of the caller's RLS
-- (avoids recursive policy evaluation). search_path is empty and every object
-- is schema-qualified.
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.role
  from public.app_users u
  where u.id = auth.uid()
    and u.active
$$;

comment on function public.current_app_role() is
  'Role of the calling user, or NULL when unauthenticated / unknown / inactive.';

create or replace function public.has_any_role(variadic p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = any (p_roles), false)
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_app_role() is not null
$$;

-- Raises a uniform permission error. Used at the top of every RPC.
create or replace function public.require_role(variadic p_roles text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_any_role(variadic p_roles) then
    raise exception 'ليس لديك صلاحية لتنفيذ هذه العملية'
      using errcode = '42501', hint = 'FORBIDDEN';
  end if;
end;
$$;

-- ─── New auth user → inactive app_users row ─────────────────────────────────
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_users (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Never allow the system to end up with no active admin.
create or replace function public.app_users_keep_one_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.role = 'admin' and old.active)
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
     and not exists (
       select 1 from public.app_users u
       where u.id <> old.id and u.role = 'admin' and u.active
     )
  then
    raise exception 'لا يمكن إزالة آخر مدير نظام مفعّل'
      using errcode = 'P0001', hint = 'LAST_ADMIN';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger app_users_keep_one_admin
  before update or delete on public.app_users
  for each row execute function public.app_users_keep_one_admin();

-- ─── Settings ───────────────────────────────────────────────────────────────
create table public.app_settings (
  key          text primary key check (key ~ '^[a-z][a-z0-9_.]*$'),
  value        jsonb not null,
  description  text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.app_users (id) on delete set null default auth.uid()
);

create or replace function public.app_settings_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger app_settings_touch
  before update on public.app_settings
  for each row execute function public.app_settings_touch();

-- Production defaults (required for the app to work; not demo data).
insert into public.app_settings (key, value, description, updated_by) values
  ('shop.name',                     to_jsonb('عطور الفراعنة'::text), 'اسم المتجر الظاهر في التطبيق', null),
  ('shop.currency',                 to_jsonb('ج.م'::text),         'رمز العملة المعروض',            null),
  ('shop.timezone',                 to_jsonb('Africa/Cairo'::text),'المنطقة الزمنية لتجميع التقارير حسب اليوم', null),
  ('inventory.allow_negative_stock', 'false'::jsonb,               'السماح بالبيع عند عدم كفاية المخزون (رصيد بالسالب)', null),
  ('sales.allow_price_override',     'false'::jsonb,               'السماح للبائع بتعديل سعر البيع (المدير ومدير النظام مسموح لهم دائماً)', null);

-- Typed readers used by business functions.
create or replace function public.setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value)::boolean from public.app_settings s
                   where s.key = p_key and jsonb_typeof(s.value) = 'boolean'), p_default)
$$;

create or replace function public.setting_text(p_key text, p_default text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.value #>> '{}' from public.app_settings s
                   where s.key = p_key and jsonb_typeof(s.value) = 'string'), p_default)
$$;

-- ─── Audit log ──────────────────────────────────────────────────────────────
-- Generic audit trail for configuration/master data. The inventory ledger and
-- sales tables are append-only by design and are their own audit trail.
create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text not null,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  actor_id    uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create index audit_log_table_record_idx on public.audit_log (table_name, record_id);
create index audit_log_created_at_idx   on public.audit_log (created_at desc);

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  -- skip no-op updates
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;
  insert into public.audit_log (table_name, record_id, action, old_data, new_data, actor_id)
  values (
    tg_table_name,
    coalesce(v_new ->> tg_argv[0], v_old ->> tg_argv[0]),
    tg_op,
    v_old,
    v_new,
    auth.uid()
  );
  return coalesce(new, old);
end;
$$;

comment on function public.audit_row_change() is
  'Attach with: create trigger ... after insert or update or delete ... execute function public.audit_row_change(''<pk column>'')';

create trigger app_users_audit
  after insert or update or delete on public.app_users
  for each row execute function public.audit_row_change('id');

create trigger app_settings_audit
  after insert or update or delete on public.app_settings
  for each row execute function public.audit_row_change('key');
