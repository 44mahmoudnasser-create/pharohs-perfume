import { useState } from "react";
import { Minus, Plus, ShoppingCart } from "lucide-react";
import { supabase } from "@/core/lib/supabase";
import { unwrap } from "@/core/lib/errors";
import { useAsync } from "@/core/hooks/useAsync";
import { useShop } from "@/core/settings/SettingsProvider";
import { AsyncBoundary } from "@/core/ui/States";
import { fmtMoney, fmtQty } from "@/core/lib/format";
import type { LineEditorProps, SaleModeDefinition } from "./saleModes";

/** Line editor for ready-made products that consume one unit of their own stock item. */
function StockItemLineEditor({ product, onAdd, reservedFor }: LineEditorProps) {
  const { currency, allowNegativeStock } = useShop();
  // availability only, through a narrow function: sellers can't read inventory tables (migration 0902)
  const stock = useAsync(async () => {
    return unwrap(await supabase.rpc("sale_product_available", { p_product_id: product.id })) as
      { quantity: number; unit: string } | null;
  }, [product.id]);
  const [qty, setQty] = useState(1);

  const stockKey = `item:${product.inventory_item_id}`;
  const available = stock.data ? Number(stock.data.quantity) - reservedFor(stockKey) : null;
  const wholeUnits = stock.data?.unit === "pcs";
  const over = available != null && qty > available && !allowNegativeStock;

  return (
    <AsyncBoundary loading={stock.loading && !stock.data} error={stock.error} onRetry={stock.reload}>
      <div className="bg-card2/60 border border-border/60 rounded-xl p-3 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-subtext">السعر</span>
          <span className="font-bold text-text tabular-nums">{fmtMoney(product.unit_price, currency)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-subtext">المتاح</span>
          <span className="tabular-nums">{available != null ? fmtQty(available, stock.data?.unit) : "—"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center rounded-lg border border-border bg-card">
            <button type="button" onClick={() => setQty(q => Math.max(wholeUnits ? 1 : 0.001, q - 1))} className="px-3 py-2 text-subtext hover:text-text" aria-label="إنقاص">
              <Minus className="w-4 h-4" />
            </button>
            <input type="number" min={wholeUnits ? 1 : 0.001} step={wholeUnits ? 1 : 0.001} value={qty}
              onChange={e => { const v = Number(e.target.value) || 1; setQty(wholeUnits ? Math.max(1, Math.floor(v)) : Math.max(0.001, v)); }}
              className="w-20 bg-transparent text-center text-sm font-bold text-text focus:outline-none" />
            <button type="button" onClick={() => setQty(q => q + 1)} className="px-3 py-2 text-subtext hover:text-text" aria-label="زيادة">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <p className="text-lg font-extrabold tabular-nums">{fmtMoney((product.unit_price ?? 0) * qty, currency)}</p>
        </div>
        {over && <p className="text-xs text-danger">الكمية المطلوبة أكبر من المتاح</p>}
        <button type="button" disabled={over || qty <= 0}
          onClick={() => { onAdd({ product, quantity: qty, params: {}, description: "", unitPrice: product.unit_price ?? 0,
            maxUnits: stock.data ? Number(stock.data.quantity) : null, stockKey }); setQty(1); }}
          className="eg-btn-primary w-full justify-center">
          <ShoppingCart className="w-4 h-4" />إضافة للفاتورة
        </button>
      </div>
    </AsyncBoundary>
  );
}

export const stockItemSaleMode: SaleModeDefinition = {
  mode: "stock_item",
  label: "منتج جاهز",
  hint: "يُباع بسعر ثابت ويُخصم من صنف مخزون واحد",
  LineEditor: StockItemLineEditor,
  usesProductStockItem: true,
};
