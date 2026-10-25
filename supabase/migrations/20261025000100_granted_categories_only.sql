-- ════════════════════════════════════════════════════════════════════════════
-- 0901 — Sellers sell and view only in their granted categories
--   • A seller can sell only in categories granted to them (user_category_access).
--   • A seller sees only the categories, products and invoice lines they're granted.
--   • A seller's invoice list keeps the 0900 rule: own invoices from today.
-- ════════════════════════════════════════════════════════════════════════════

-- Re-enable the category guard on sale lines (removed in 0900). It runs inside
-- sales_create_sale's transaction, so a refused line rolls back the whole sale.
create or replace function public.sale_lines_check_category_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_access_category(new.category_id) then
    raise exception 'ليس لديك صلاحية البيع في هذا التصنيف'
      using errcode = '42501', hint = 'CATEGORY_FORBIDDEN';
  end if;
  return new;
end;
$$;

create trigger sale_lines_check_category_access
  before insert on public.sale_lines
  for each row execute function public.sale_lines_check_category_access();

-- Catalogue: sellers see only granted categories and their products.
drop policy categories_select on public.categories;
create policy categories_select on public.categories for select to authenticated
  using (public.can_access_category(id));

drop policy products_select on public.products;
create policy products_select on public.products for select to authenticated
  using (public.can_access_category(category_id));

comment on function public.can_access_category(bigint) is
  'Whether the caller may sell in and see this category: all for admins and managers, granted categories for sellers.';
