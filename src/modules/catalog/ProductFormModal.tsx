import { useState } from "react";
import Modal from "@/core/ui/Modal";
import { Field, FormError } from "@/core/ui/Form";
import { useNotify } from "@/core/ui/Notifications";
import { useAsync } from "@/core/hooks/useAsync";
import { errorMessage } from "@/core/lib/errors";
import { UNIT_LABEL } from "@/core/lib/format";
import { useSaleModes } from "@/modules/sales/saleModes";
import { listStock } from "@/modules/inventory/api";
import { saveProduct, type Category, type Product, type ProductInput } from "./api";

export default function ProductFormModal({
  product, categories, onClose, onSaved,
}: {
  product: Product | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const saleModes = useSaleModes();
  const notify = useNotify();
  const stock = useAsync(listStock, []);

  // After creating a product we stay open so mode-specific settings can be added.
  const [productId, setProductId] = useState<number | null>(product?.id ?? null);
  const [form, setForm] = useState<ProductInput>(() => ({
    category_id: product?.category_id ?? categories.find(c => c.active)?.id ?? categories[0]?.id ?? 0,
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    description: product?.description ?? "",
    image_url: product?.image_url ?? "",
    sale_mode: product?.sale_mode ?? "stock_item",
    inventory_item_id: product?.inventory_item_id ?? null,
    unit_price: product?.unit_price ?? null,
    sort_order: product?.sort_order ?? 0,
    active: product?.active ?? true,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // the sale mode comes from the category; products never choose it themselves
  const selectedCategory = categories.find(c => c.id === form.category_id);
  const saleModeKey = selectedCategory?.sale_mode ?? "stock_item";
  const mode = saleModes.get(saleModeKey);
  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { setError("اسم المنتج مطلوب"); return; }
    if (!form.category_id) { setError("اختر التصنيف"); return; }
    if (form.image_url && !/^https?:\/\//i.test(form.image_url)) { setError("رابط الصورة يجب أن يبدأ بـ http:// أو https://"); return; }
    if (mode?.usesProductStockItem) {
      if (!form.inventory_item_id) { setError("اختر صنف المخزون الذي يُخصم عند البيع"); return; }
      if (form.unit_price == null || form.unit_price < 0) { setError("أدخل سعر بيع صحيح"); return; }
    }
    setSaving(true); setError("");
    try {
      const id = await saveProduct({
        ...form,
        sale_mode: saleModeKey,
        name: form.name.trim(),
        sku: form.sku?.trim() || null,
        description: form.description?.trim() || null,
        image_url: form.image_url?.trim() || null,
        inventory_item_id: mode?.usesProductStockItem ? form.inventory_item_id : null,
        unit_price: mode?.usesProductStockItem ? form.unit_price : null,
      }, productId ?? undefined);
      await onSaved();
      notify.success(`تم حفظ ${form.name.trim()}`);
      if (!productId && mode?.ProductExtension) setProductId(id);
      else onClose();
    } catch (e) { setError(errorMessage(e)); }
    setSaving(false);
  };

  const Extension = productId && mode?.ProductExtension;
  // Items that are linked to bottle sizes / oil types are consumed by the perfume engine, not sold directly.
  const sellableItems = (stock.data ?? []).filter(i => i.active && !i.oil_type_id && !i.bottle_size_id);

  return (
    <Modal open onClose={onClose} size="lg"
      title={productId ? `تعديل ${product?.name ?? form.name}` : "منتج جديد"}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="اسم المنتج" required>
            <input value={form.name} onChange={e => set("name", e.target.value)} className="eg-input" placeholder="مثال: عطر بلو" autoFocus />
          </Field>
          <Field label="الكود (SKU)" hint="اختياري — يجب أن يكون فريداً">
            <input value={form.sku ?? ""} onChange={e => set("sku", e.target.value)} className="eg-input font-mono" dir="ltr" />
          </Field>
          <Field label="التصنيف" required>
            <select value={form.category_id} onChange={e => set("category_id", Number(e.target.value))} className="eg-select">
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (متوقف)"}</option>)}
            </select>
          </Field>
          <Field label="طريقة البيع" hint={mode?.hint ?? "تُحدد من التصنيف"}>
            <div className="eg-input !text-subtext">{saleModes.label(saleModeKey)}</div>
          </Field>
        </div>

        {mode?.usesProductStockItem && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-card2/50 rounded-lg p-3 border border-border/50">
            <Field label="صنف المخزون الذي يُخصم" required hint={stock.loading ? "جاري التحميل..." : "قطعة واحدة من هذا الصنف لكل وحدة مباعة"}>
              <select value={form.inventory_item_id ?? ""} onChange={e => set("inventory_item_id", e.target.value ? Number(e.target.value) : null)} className="eg-select">
                <option value="">— اختر —</option>
                {sellableItems.map(i => <option key={i.item_id} value={i.item_id}>{i.name} ({UNIT_LABEL[i.unit]})</option>)}
              </select>
            </Field>
            <Field label="سعر البيع" required>
              <input type="number" min={0} step="0.01" value={form.unit_price ?? ""}
                onChange={e => set("unit_price", e.target.value === "" ? null : Number(e.target.value))} className="eg-input" />
            </Field>
          </div>
        )}

        <Field label="الوصف">
          <textarea value={form.description ?? ""} onChange={e => set("description", e.target.value)} rows={2} className="eg-input" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
          <Field label="رابط الصورة" hint="اختياري — رابط صورة عام (https://...)">
            <input value={form.image_url ?? ""} onChange={e => set("image_url", e.target.value)} className="eg-input" dir="ltr" placeholder="https://" />
          </Field>
          {form.image_url && /^https?:\/\//i.test(form.image_url) && (
            <img src={form.image_url} alt="" className="w-16 h-16 rounded-lg object-cover bg-card2 border border-border" />
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الترتيب">
            <input type="number" value={form.sort_order} onChange={e => set("sort_order", Number(e.target.value) || 0)} className="eg-input" />
          </Field>
          <Field label="الحالة">
            <select value={form.active ? "1" : "0"} onChange={e => set("active", e.target.value === "1")} className="eg-select">
              <option value="1">مفعّل</option>
              <option value="0">متوقف</option>
            </select>
          </Field>
        </div>

        <FormError message={error} />
        <div className="flex gap-2">
          <button onClick={save} disabled={saving} className="eg-btn-primary flex-1 justify-center">
            {saving ? "جاري الحفظ..." : "حفظ المنتج"}
          </button>
          {productId && <button onClick={onClose} className="eg-btn-ghost">إغلاق</button>}
        </div>

        {Extension && (
          <div className="border-t border-border/50 pt-4">
            <Extension productId={productId} />
          </div>
        )}
      </div>
    </Modal>
  );
}
