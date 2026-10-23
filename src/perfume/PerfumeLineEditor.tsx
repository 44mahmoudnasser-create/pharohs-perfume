import { useMemo, useState } from "react";
import { AlertTriangle, Minus, Plus, ShoppingCart } from "lucide-react";
import { useAsync } from "@/core/hooks/useAsync";
import { useShop } from "@/core/settings/SettingsProvider";
import { AsyncBoundary, EmptyState } from "@/core/ui/States";
import { cn } from "@/core/lib/cn";
import { fmtInt, fmtMoney, fmtNum } from "@/core/lib/format";
import type { LineEditorProps } from "@/modules/sales/saleModes";
import { getSaleOptions, type SaleOption } from "./api";

const STATUS_TEXT: Record<SaleOption["status"], string> = {
  ok: "",
  not_allowed: "غير متاح لهذا العطر",
  missing_rule: "لا توجد قاعدة استهلاك — يجب على مدير النظام إضافتها",
  missing_price: "لا يوجد سعر محدد لهذا الاختيار",
  out_of_stock: "المخزون غير كافٍ",
};

/**
 * Sales-screen editor for perfume formulations:
 * size → oil type → quantity. Everything shown here comes from
 * perfume_sale_options(); the database re-validates at checkout.
 */
export default function PerfumeLineEditor({ product, onAdd, reservedFor }: LineEditorProps) {
  const { currency, allowNegativeStock } = useShop();
  const options = useAsync(() => getSaleOptions(product.id), [product.id]);
  const [sizeId, setSizeId] = useState<number | null>(null);
  const [oilId, setOilId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);

  const allowed = useMemo(() => (options.data ?? []).filter(o => o.status !== "not_allowed"), [options.data]);
  const sizes = useMemo(() => {
    const seen = new Map<number, SaleOption>();
    allowed.forEach(o => { if (!seen.has(o.bottle_size_id)) seen.set(o.bottle_size_id, o); });
    return [...seen.values()];
  }, [allowed]);
  const oilsForSize = allowed.filter(o => o.bottle_size_id === sizeId);
  const selected = allowed.find(o => o.bottle_size_id === sizeId && o.oil_type_id === oilId) ?? null;

  const stockKey = selected ? `perfume:${selected.bottle_size_id}:${selected.oil_type_id}` : "";
  const remaining = selected?.max_units != null ? selected.max_units - reservedFor(stockKey) : null;
  const sellable = !!selected && (selected.status === "ok" || (selected.status === "out_of_stock" && allowNegativeStock));
  const overStock = remaining != null && qty > remaining && !allowNegativeStock;

  const add = () => {
    if (!selected || !sellable || overStock || qty < 1) return;
    onAdd({
      product,
      quantity: qty,
      params: { bottle_size_id: selected.bottle_size_id, oil_type_id: selected.oil_type_id },
      description: `${selected.bottle_size_name} · زيت ${selected.oil_type_name}`,
      unitPrice: selected.unit_price ?? 0,
      maxUnits: selected.max_units,
      stockKey,
    });
    setQty(1);
  };

  return (
    <AsyncBoundary loading={options.loading && !options.data} error={options.error} onRetry={options.reload}>
      {sizes.length === 0 ? (
        <EmptyState message="لا توجد أحجام أو زيوت متاحة لهذا العطر. راجع إعدادات الأحجام والزيوت." />
      ) : (
        <div className="space-y-4">
          <div>
            <p className="eg-label">1. حجم الزجاجة</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {sizes.map(s => (
                <button key={s.bottle_size_id} type="button"
                  onClick={() => { setSizeId(s.bottle_size_id); setOilId(null); }}
                  className={cn("rounded-lg border px-2 py-2.5 text-sm font-semibold transition-colors",
                    sizeId === s.bottle_size_id ? "border-accent bg-accent/15 text-text" : "border-border bg-card2 text-subtext hover:text-text")}>
                  {s.bottle_size_name}
                  <span className="block text-[10px] font-normal text-subtext tabular-nums">
                    متاح {fmtInt(s.bottles_available ?? 0)} زجاجة
                  </span>
                </button>
              ))}
            </div>
          </div>

          {sizeId != null && (
            <div>
              <p className="eg-label">2. نوع الزيت</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {oilsForSize.map(o => {
                  const disabled = o.status === "missing_rule" || o.status === "missing_price";
                  return (
                    <button key={o.oil_type_id} type="button" disabled={disabled}
                      onClick={() => setOilId(o.oil_type_id)}
                      className={cn("rounded-lg border px-3 py-2.5 text-right transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
                        oilId === o.oil_type_id ? "border-accent bg-accent/15" : "border-border bg-card2 hover:border-accent/40",
                        disabled && "border-dashed border-danger/40")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-text">{o.oil_type_name}</span>
                        {o.unit_price != null && <span className="text-xs tabular-nums text-accent">{fmtMoney(o.unit_price, currency)}</span>}
                      </div>
                      <p className={cn("text-[11px] mt-0.5", o.status === "ok" ? "text-subtext" : o.status === "out_of_stock" ? "text-warning" : "text-danger")}>
                        {o.status === "ok" || o.status === "out_of_stock"
                          ? `${fmtNum(o.grams_per_bottle)} جم/زجاجة · يكفي ${fmtInt(o.max_units ?? 0)} زجاجة`
                          : STATUS_TEXT[o.status]}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selected && (
            <div className="bg-card2/60 border border-border/60 rounded-xl p-3 space-y-3">
              {selected.status !== "ok" && (
                <p className={cn("text-xs flex items-center gap-1.5", sellable ? "text-warning" : "text-danger")}>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {STATUS_TEXT[selected.status]}{sellable && " — البيع مسموح بالسالب حسب الإعدادات"}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="eg-label !mb-1">3. عدد الزجاجات</p>
                  <div className="inline-flex items-center rounded-lg border border-border bg-card">
                    <button type="button" onClick={() => setQty(q => Math.max(1, q - 1))} className="px-3 py-2 text-subtext hover:text-text" aria-label="إنقاص">
                      <Minus className="w-4 h-4" />
                    </button>
                    <input type="number" min={1} step={1} value={qty}
                      onChange={e => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                      className="w-16 bg-transparent text-center text-sm font-bold text-text focus:outline-none" />
                    <button type="button" onClick={() => setQty(q => q + 1)} className="px-3 py-2 text-subtext hover:text-text" aria-label="زيادة">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="text-left">
                  <p className="text-[11px] text-subtext">الإجمالي</p>
                  <p className="text-xl font-extrabold text-text tabular-nums">{fmtMoney((selected.unit_price ?? 0) * qty, currency)}</p>
                  <p className="text-[11px] text-subtext tabular-nums">استهلاك {fmtNum((selected.grams_per_bottle ?? 0) * qty)} جم زيت + {fmtInt(qty)} زجاجة</p>
                </div>
              </div>
              {overStock && (
                <p className="text-xs text-danger">
                  المتاح {fmtInt(Math.max(0, remaining ?? 0))} زجاجة فقط{reservedFor(stockKey) > 0 && " (مع احتساب ما في السلة)"}
                </p>
              )}
              <button type="button" onClick={add} disabled={!sellable || overStock}
                className="eg-btn-primary w-full justify-center">
                <ShoppingCart className="w-4 h-4" />إضافة للفاتورة
              </button>
            </div>
          )}
        </div>
      )}
    </AsyncBoundary>
  );
}
