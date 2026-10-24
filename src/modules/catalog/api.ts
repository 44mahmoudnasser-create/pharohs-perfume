import { supabase } from "@/core/lib/supabase";
import { unwrap } from "@/core/lib/errors";

export type Category = {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
  active: boolean;
  sale_mode: string;
  created_at: string;
  updated_at: string;
  product_count: number;
};

export type Product = {
  id: number;
  category_id: number;
  name: string;
  sku: string | null;
  description: string | null;
  image_url: string | null;
  sale_mode: string;
  inventory_item_id: number | null;
  unit_price: number | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  category: { name: string; active: boolean } | null;
  inventory_item: { name: string; unit: string } | null;
};

export type CategoryInput = Pick<Category, "name" | "description" | "sort_order" | "active" | "sale_mode">;
export type ProductInput = Pick<Product,
  "category_id" | "name" | "sku" | "description" | "image_url" | "sale_mode" |
  "inventory_item_id" | "unit_price" | "sort_order" | "active">;

export async function listCategories(): Promise<Category[]> {
  const rows = unwrap(await supabase.from("categories")
    .select("*, products(count)").order("sort_order").order("name"));
  return (rows as (Omit<Category, "product_count"> & { products: { count: number }[] })[])
    .map(({ products, ...c }) => ({ ...c, product_count: products?.[0]?.count ?? 0 }));
}

export async function saveCategory(input: CategoryInput, id?: number) {
  const q = id
    ? supabase.from("categories").update(input).eq("id", id)
    : supabase.from("categories").insert(input);
  unwrap(await q.select("id").single());
}

export async function deleteCategory(id: number) {
  unwrap(await supabase.from("categories").delete().eq("id", id).select("id").single());
}

export async function deleteProduct(id: number) {
  unwrap(await supabase.from("products").delete().eq("id", id).select("id").single());
}

export async function setCategoryActive(id: number, active: boolean) {
  unwrap(await supabase.from("categories").update({ active }).eq("id", id).select("id").single());
}

export async function listProducts(): Promise<Product[]> {
  return unwrap(await supabase.from("products")
    .select("*, category:categories(name, active), inventory_item:inventory_items(name, unit)")
    .order("sort_order").order("name")) as Product[];
}

export async function saveProduct(input: ProductInput, id?: number): Promise<number> {
  const q = id
    ? supabase.from("products").update(input).eq("id", id)
    : supabase.from("products").insert(input);
  const row = unwrap(await q.select("id").single()) as { id: number };
  return row.id;
}

export async function setProductActive(id: number, active: boolean) {
  unwrap(await supabase.from("products").update({ active }).eq("id", id).select("id").single());
}
