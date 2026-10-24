import { supabase } from "@/core/lib/supabase";
import { unwrap } from "@/core/lib/errors";

export type BottleSize = {
  id: number;
  name: string;
  volume_ml: number;
  inventory_item_id: number;
  sort_order: number;
  active: boolean;
};

export type OilType = {
  id: number;
  name: string;
  description: string | null;
  inventory_item_id: number;
  sort_order: number;
  active: boolean;
};

export type ConsumptionRule = {
  id: number;
  oil_type_id: number;
  bottle_size_id: number;
  grams_per_bottle: number;
  notes: string | null;
  updated_at: string;
};

export type PerfumePrice = {
  id: number;
  product_id: number | null;
  bottle_size_id: number;
  oil_type_id: number;
  price: number;
};

export type SaleOption = {
  bottle_size_id: number;
  bottle_size_name: string;
  volume_ml: number;
  oil_type_id: number;
  oil_type_name: string;
  rule_id: number | null;
  grams_per_bottle: number | null;
  unit_price: number | null;
  oil_available: number | null;
  bottles_available: number | null;
  max_units: number | null;
  status: "ok" | "not_allowed" | "missing_rule" | "missing_price" | "out_of_stock";
};

const num = <T extends object>(rows: T[], keys: (keyof T)[]) =>
  rows.map(r => {
    const o = { ...r } as Record<keyof T, unknown>;
    keys.forEach(k => { if (o[k] != null) o[k] = Number(o[k]); });
    return o as T;
  });

// ─── Bottle sizes ───
export async function listBottleSizes(): Promise<BottleSize[]> {
  const rows = unwrap(await supabase.from("bottle_sizes").select("*").order("sort_order").order("volume_ml")) as BottleSize[];
  return num(rows, ["volume_ml"]);
}
export async function saveBottleSize(input: Pick<BottleSize, "name" | "volume_ml" | "sort_order" | "active">, id?: number) {
  const q = id ? supabase.from("bottle_sizes").update(input).eq("id", id) : supabase.from("bottle_sizes").insert(input);
  unwrap(await q.select("id").single());
}

export async function deleteBottleSize(id: number) {
  unwrap(await supabase.from("bottle_sizes").delete().eq("id", id).select("id").single());
}

// ─── Oil types ───
export async function listOilTypes(): Promise<OilType[]> {
  return unwrap(await supabase.from("oil_types").select("*").order("sort_order").order("name")) as OilType[];
}
export async function deleteOilType(id: number) {
  unwrap(await supabase.from("oil_types").delete().eq("id", id).select("id").single());
}
export async function saveOilType(input: Pick<OilType, "name" | "description" | "sort_order" | "active">, id?: number) {
  const q = id ? supabase.from("oil_types").update(input).eq("id", id) : supabase.from("oil_types").insert(input);
  unwrap(await q.select("id").single());
}

// ─── Consumption rules ───
export async function listRules(): Promise<ConsumptionRule[]> {
  const rows = unwrap(await supabase.from("oil_consumption_rules").select("*")) as ConsumptionRule[];
  return num(rows, ["grams_per_bottle"]);
}
export async function saveRule(oilTypeId: number, bottleSizeId: number, grams: number, existingId?: number) {
  const q = existingId
    ? supabase.from("oil_consumption_rules").update({ grams_per_bottle: grams }).eq("id", existingId)
    : supabase.from("oil_consumption_rules").insert({ oil_type_id: oilTypeId, bottle_size_id: bottleSizeId, grams_per_bottle: grams });
  unwrap(await q.select("id").single());
}
export async function deleteRule(id: number) {
  unwrap(await supabase.from("oil_consumption_rules").delete().eq("id", id).select("id").single());
}

// ─── Prices ───
/** productId = null → default prices; otherwise default + that product's overrides. */
export async function listPrices(productId: number | null): Promise<PerfumePrice[]> {
  let q = supabase.from("perfume_prices").select("id, product_id, bottle_size_id, oil_type_id, price");
  q = productId == null ? q.is("product_id", null) : q.or(`product_id.is.null,product_id.eq.${productId}`);
  return num(unwrap(await q) as PerfumePrice[], ["price"]);
}
export async function savePrice(productId: number | null, bottleSizeId: number, oilTypeId: number, price: number, existingId?: number) {
  const q = existingId
    ? supabase.from("perfume_prices").update({ price }).eq("id", existingId)
    : supabase.from("perfume_prices").insert({ product_id: productId, bottle_size_id: bottleSizeId, oil_type_id: oilTypeId, price });
  unwrap(await q.select("id").single());
}
export async function deletePrice(id: number) {
  unwrap(await supabase.from("perfume_prices").delete().eq("id", id).select("id").single());
}

// ─── Per-product restrictions ───
export async function getRestrictions(productId: number) {
  const [sizes, oils] = await Promise.all([
    supabase.from("perfume_product_bottle_sizes").select("bottle_size_id").eq("product_id", productId),
    supabase.from("perfume_product_oil_types").select("oil_type_id").eq("product_id", productId),
  ]);
  return {
    sizeIds: (unwrap(sizes) as { bottle_size_id: number }[]).map(r => r.bottle_size_id),
    oilIds: (unwrap(oils) as { oil_type_id: number }[]).map(r => r.oil_type_id),
  };
}
export async function setRestrictions(productId: number, sizeIds: number[], oilIds: number[]) {
  unwrap(await supabase.rpc("perfume_set_product_restrictions", {
    p_product_id: productId, p_bottle_size_ids: sizeIds, p_oil_type_ids: oilIds,
  }));
}

// ─── Sales screen ───
export async function getSaleOptions(productId: number): Promise<SaleOption[]> {
  const rows = unwrap(await supabase.rpc("perfume_sale_options", { p_product_id: productId })) as SaleOption[];
  return num(rows, ["volume_ml", "grams_per_bottle", "unit_price", "oil_available", "bottles_available"]);
}
