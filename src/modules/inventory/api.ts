import { supabase } from "@/core/lib/supabase";
import { unwrap } from "@/core/lib/errors";

export type ItemGroup = "raw_material" | "packaging" | "merchandise" | "other";
export type Unit = "g" | "pcs" | "ml";

export const GROUP_LABEL: Record<ItemGroup, string> = {
  raw_material: "خامات (زيوت)",
  packaging: "تعبئة (زجاجات)",
  merchandise: "منتجات جاهزة",
  other: "أخرى",
};

export const MOVEMENT_LABEL: Record<string, string> = {
  opening: "رصيد افتتاحي",
  receipt: "استلام",
  sale: "بيع",
  reversal: "عكس (إلغاء)",
  adjustment: "تسوية",
  waste: "تالف",
  stocktake: "جرد فعلي",
};

export type StockRow = {
  item_id: number;
  name: string;
  sku: string | null;
  unit: Unit;
  item_group: ItemGroup;
  reorder_level: number;
  active: boolean;
  quantity: number;
  last_movement_at: string | null;
  is_low: boolean;
  oil_type_id: number | null;
  oil_type_name: string | null;
  bottle_size_id: number | null;
  bottle_size_name: string | null;
  volume_ml: number | null;
};

export type Movement = {
  id: number;
  item_id: number;
  quantity: number;
  unit: Unit;
  movement_type: string;
  reference_type: string | null;
  reference_id: number | null;
  reverses_movement_id: number | null;
  balance_after: number;
  note: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  item: { name: string } | null;
};

export type ItemInput = {
  name: string;
  sku: string | null;
  unit: Unit;
  item_group: ItemGroup;
  reorder_level: number;
  notes: string | null;
  active: boolean;
};

export async function listStock(): Promise<StockRow[]> {
  return unwrap(await supabase.from("v_inventory_stock").select("*")
    .order("item_group").order("volume_ml", { nullsFirst: true }).order("name")) as StockRow[];
}

export async function saveItem(input: Partial<ItemInput>, id?: number) {
  const q = id
    ? supabase.from("inventory_items").update(input).eq("id", id)
    : supabase.from("inventory_items").insert(input);
  unwrap(await q.select("id").single());
}

export async function receiveStock(itemId: number, quantity: number, note: string) {
  unwrap(await supabase.rpc("inventory_receive", { p_item_id: itemId, p_quantity: quantity, p_note: note || null }));
}

export async function adjustStock(itemId: number, delta: number, reason: string, type: "adjustment" | "waste") {
  unwrap(await supabase.rpc("inventory_adjust", { p_item_id: itemId, p_delta: delta, p_reason: reason, p_movement_type: type }));
}

export async function recordCount(itemId: number, counted: number, note: string): Promise<number | null> {
  return unwrap(await supabase.rpc("inventory_record_count", { p_item_id: itemId, p_counted: counted, p_note: note || null })) as number | null;
}

export type MovementFilter = {
  itemId?: number | null;
  type?: string | null;
  from?: string | null;   // yyyy-mm-dd (local)
  to?: string | null;
  referenceType?: string;
  referenceId?: number;
};

export async function listMovements(f: MovementFilter, page: number, pageSize: number) {
  let q = supabase.from("inventory_movements")
    .select("*, item:inventory_items(name)", { count: "exact" })
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (f.itemId) q = q.eq("item_id", f.itemId);
  if (f.type) q = q.eq("movement_type", f.type);
  if (f.from) q = q.gte("created_at", new Date(f.from + "T00:00:00").toISOString());
  if (f.to) q = q.lt("created_at", new Date(new Date(f.to + "T00:00:00").getTime() + 86400000).toISOString());
  if (f.referenceType) q = q.eq("reference_type", f.referenceType);
  if (f.referenceId) q = q.eq("reference_id", f.referenceId);
  const res = await q;
  return { rows: unwrap(res) as Movement[], total: res.count ?? 0 };
}
