-- ════════════════════════════════════════════════════════════════════════════
-- 0900 — Selling and viewing are separate
--   • A seller can sell in every active category.
--   • user_category_access decides which categories' lines a seller sees in
--     their own invoices.
--   • A seller sees only their own invoices from today, and inside each one
--     only the lines of categories granted to them.
-- ════════════════════════════════════════════════════════════════════════════

-- Selling is no longer limited by category.
drop trigger sale_lines_check_category_access on public.sale_lines;
drop function public.sale_lines_check_category_access();

-- Sellers see the whole catalogue (to sell). Admins and managers see everything as before.
drop policy categories_select on public.categories;
create policy categories_select on public.categories for select to authenticated
  using ((select public.is_active_user()));

drop policy products_select on public.products;
create policy products_select on public.products for select to authenticated
  using ((select public.is_active_user()));

-- A seller's invoice is visible when it's theirs, from today, and has at least one granted line.
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
        and s.created_by = auth.uid()
        and public.shop_date(s.created_at) = public.shop_date(now()))
    else false
  end
$$;

comment on function public.can_access_category(bigint) is
  'Whether the caller may see lines of this category: all for admins and managers, granted categories for sellers.';
