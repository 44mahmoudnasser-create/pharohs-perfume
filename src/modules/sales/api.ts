import { supabase } from "@/core/lib/supabase";
import { unwrap } from "@/core/lib/errors";
import type { CartLineDraft } from "./saleModes";

export type SaleSummary = {
  id: number;
  status: "completed" | "cancelled";
  customer_name: string | null;
  notes: string | null;
  total: number;
  created_by: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  // only the lines this user may see (RLS); totals shown in the UI come from these
  sale_lines: { product_name: string; quantity: number; line_total: number }[];
};

export type SaleLineDetail = {
  id: number;
  line_no: number;
  product_name: string;
  category_name: string;
  sale_mode: string;
  quantity: number;
  list_unit_price: number;
  unit_price: number;
  line_total: number;
  perfume: {
    bottle_size_name: string;
    bottle_volume_ml: number;
    oil_type_name: string;
    grams_per_bottle: number;
    oil_grams_total: number;
    bottles_total: number;
  } | null;
  components: {
    id: number;
    item_name: string;
    unit: string;
    quantity_per_unit: number;
    quantity_total: number;
    source: string;
    movement_id: number;
  }[];
};

export type SaleDetail = SaleSummary & { cancelled_by: string | null; lines: SaleLineDetail[] };

type RawLine = Omit<SaleLineDetail, "perfume"> & { perfume: SaleLineDetail["perfume"] | NonNullable<SaleLineDetail["perfume"]>[] };

export type CreateSaleResult = { sale_id: number; total: number; duplicate: boolean };

/** One atomic, idempotent RPC — never several independent writes. */
export async function createSale(idempotencyKey: string, cart: CartLineDraft[], customerName: string, notes: string) {
  const lines = cart.map(l => ({ product_id: l.product.id, quantity: l.quantity, ...l.params }));
  return unwrap(await supabase.rpc("sales_create_sale", {
    p_idempotency_key: idempotencyKey,
    p_lines: lines,
    p_customer_name: customerName || null,
    p_notes: notes || null,
  })) as CreateSaleResult;
}

export async function cancelSale(saleId: number, reason: string) {
  unwrap(await supabase.rpc("sales_cancel_sale", { p_sale_id: saleId, p_reason: reason }));
}

export async function listSales(from: string, to: string, status: string): Promise<SaleSummary[]> {
  let q = supabase.from("sales")
    .select("id, status, customer_name, notes, total, created_by, created_at, cancelled_at, cancel_reason, sale_lines(product_name, quantity, line_total)")
    .gte("created_at", new Date(from + "T00:00:00").toISOString())
    .lt("created_at", new Date(new Date(to + "T00:00:00").getTime() + 86400000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1000);
  if (status !== "all") q = q.eq("status", status);
  return unwrap(await q) as SaleSummary[];
}

export async function getSale(id: number): Promise<SaleDetail> {
  const row = unwrap(await supabase.from("sales")
    .select(`*, sale_lines(id, line_no, product_name, category_name, sale_mode, quantity, list_unit_price, unit_price, line_total,
             perfume:perfume_sale_line_details(bottle_size_name, bottle_volume_ml, oil_type_name, grams_per_bottle, oil_grams_total, bottles_total),
             components:sale_line_components(id, item_name, unit, quantity_per_unit, quantity_total, source, movement_id))`)
    .eq("id", id).single()) as Omit<SaleDetail, "lines" | "sale_lines"> & { sale_lines: RawLine[] };
  // PostgREST returns a one-to-one embed as an object or a 1-item array depending on detection
  const lines: SaleLineDetail[] = row.sale_lines
    .map(l => ({ ...l, perfume: Array.isArray(l.perfume) ? l.perfume[0] ?? null : l.perfume }))
    .sort((a, b) => a.line_no - b.line_no);
  return {
    ...row,
    sale_lines: lines.map(l => ({ product_name: l.product_name, quantity: l.quantity, line_total: l.line_total })),
    lines,
  };
}

export async function getUserNames(): Promise<Record<string, string>> {
  const rows = unwrap(await supabase.from("user_directory").select("id, display_name")) as { id: string; display_name: string }[];
  return Object.fromEntries(rows.map(r => [r.id, r.display_name]));
}

export type CatalogForSale = {
  categories: { id: number; name: string; sort_order: number }[];
  products: import("./saleModes").SellableProduct[];
};

/** Active categories + active products, for the new-sale screen. */
export async function loadSaleCatalog(): Promise<CatalogForSale> {
  const [cats, prods] = await Promise.all([
    supabase.from("categories").select("id, name, sort_order").eq("active", true).order("sort_order").order("name"),
    supabase.from("products")
      .select("id, name, sku, category_id, sale_mode, unit_price, inventory_item_id, image_url, description")
      .eq("active", true).order("sort_order").order("name"),
  ]);
  return { categories: unwrap(cats) as CatalogForSale["categories"], products: unwrap(prods) as CatalogForSale["products"] };
}
