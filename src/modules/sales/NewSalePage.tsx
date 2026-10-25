import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ImageOff, Receipt, Trash2 } from "lucide-react";
import PageHeader from "@/core/ui/PageHeader";
import { AsyncBoundary, EmptyState } from "@/core/ui/States";
import { FormError } from "@/core/ui/Form";
import { useAsync } from "@/core/hooks/useAsync";
import { useShop } from "@/core/settings/SettingsProvider";
import { errorMessage } from "@/core/lib/errors";
import { cn } from "@/core/lib/cn";
import { fmtInt, fmtMoney, fmtNum } from "@/core/lib/format";
import { createSale, loadSaleCatalog, type CreateSaleResult } from "./api";
import { useSaleModes, type CartLineDraft, type SellableProduct } from "./saleModes";

type CartLine = CartLineDraft & { key: string };

export default function NewSalePage() {
  const catalog = useAsync(loadSaleCatalog, []);
  const { currency } = useShop();
  const saleModes = useSaleModes();

  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [product, setProduct] = useState<SellableProduct | null>(null);
  const [cart, setCartState] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState("");
  const [notes, setNotes] = useState("");
  // One key per cart content: a retry of the same cart reuses it (no double
  // deduction); any change to the cart produces a new key.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<CreateSaleResult | null>(null);

  const setCart = (fn: (c: CartLine[]) => CartLine[]) => {
    setCartState(fn);
    setIdempotencyKey(crypto.randomUUID());
    setError("");
  };

  const categories = useMemo(() => (catalog.data?.categories ?? [])
    .filter(c => catalog.data!.products.some(p => p.category_id === c.id && saleModes.get(p.sale_mode))), [catalog.data, saleModes]);
  const activeCategory = categoryId ?? categories[0]?.id ?? null;
  const products = (catalog.data?.products ?? []).filter(p => p.category_id === activeCategory && saleModes.get(p.sale_mode));
  const Editor = product ? saleModes.get(product.sale_mode)?.LineEditor : undefined;

  const total = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const reservedFor = (stockKey: string) => cart.filter(l => l.stockKey === stockKey).reduce((s, l) => s + l.quantity, 0);

  const addLine = (d: CartLineDraft) => {
    setCart(c => {
      // merge identical selections into one line
      const same = c.find(l => l.product.id === d.product.id && JSON.stringify(l.params) === JSON.stringify(d.params));
      if (same) return c.map(l => (l === same ? { ...l, quantity: l.quantity + d.quantity } : l));
      return [...c, { ...d, key: crypto.randomUUID() }];
    });
  };

  const checkout = async () => {
    // a ref, not state: a second click in the same tick must not start another request
    if (inFlight.current || cart.length === 0) return;
    inFlight.current = true;
    setSubmitting(true); setError("");
    try {
      const r = await createSale(idempotencyKey, cart, customer.trim(), notes.trim());
      setDone(r);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const reset = () => {
    setCartState([]); setCustomer(""); setNotes(""); setProduct(null); setDone(null); setError("");
    setIdempotencyKey(crypto.randomUUID());
    void catalog.reload();
  };

  if (done) {
    return (
      <>
        <PageHeader title="بيع جديد" />
        <div className="p-4 md:p-6">
          <div className="eg-card max-w-md mx-auto text-center space-y-4 py-8">
            <CheckCircle2 className="w-12 h-12 text-success mx-auto" />
            <div>
              <h2 className="text-lg font-bold text-text">تم تسجيل الفاتورة #{fmtInt(done.sale_id)}</h2>
              <p className="text-2xl font-extrabold text-success tabular-nums mt-2">{fmtMoney(done.total, currency)}</p>
              {done.duplicate && <p className="text-xs text-warning mt-2">هذه الفاتورة كانت مسجلة بالفعل — لم يتم الخصم مرتين.</p>}
            </div>
            <div className="flex gap-2 justify-center">
              <button onClick={reset} className="eg-btn-primary">فاتورة جديدة</button>
              <Link to={`/sales?open=${done.sale_id}`} className="eg-btn-ghost">عرض الفاتورة</Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="بيع جديد" subtitle="اختر التصنيف ثم المنتج ثم التفاصيل" />
      <AsyncBoundary loading={catalog.loading && !catalog.data} error={catalog.error} onRetry={catalog.reload}>
        <div className="p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* ═══ product selection ═══ */}
          <div className="lg:col-span-7 space-y-4">
            {categories.length === 0 ? (
              <div className="eg-card"><EmptyState message="لا توجد منتجات مفعّلة للبيع" /></div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {categories.map(c => (
                    <button key={c.id} onClick={() => { setCategoryId(c.id); setProduct(null); }}
                      className={cn("px-4 py-2 rounded-lg text-sm transition-colors border",
                        activeCategory === c.id ? "bg-accent text-white border-accent font-semibold" : "bg-card border-border/60 text-subtext hover:text-text")}>
                      {c.name}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {products.map(p => (
                    <button key={p.id} onClick={() => setProduct(p)}
                      className={cn("eg-card !p-3 text-right transition-colors flex items-center gap-3",
                        product?.id === p.id ? "!border-accent bg-accent/10" : "hover:border-accent/40")}>
                      {p.image_url
                        ? <img src={p.image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" loading="lazy" />
                        : <div className="w-10 h-10 rounded-lg bg-card2 flex items-center justify-center shrink-0"><ImageOff className="w-4 h-4 text-subtext/50" /></div>}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text truncate">{p.name}</p>
                        <p className="text-[11px] text-subtext truncate">
                          {p.unit_price != null ? fmtMoney(p.unit_price, currency) : saleModes.label(p.sale_mode)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>

                {product && Editor && (
                  <div className="eg-card !p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-bold text-text">{product.name}</h2>
                      <button onClick={() => setProduct(null)} className="text-xs text-subtext hover:text-text">إغلاق</button>
                    </div>
                    <Editor key={product.id} product={product} onAdd={addLine} reservedFor={reservedFor} />
                  </div>
                )}
              </>
            )}
          </div>

          {/* ═══ cart ═══ */}
          <div className="lg:col-span-5">
            <div className="eg-card !p-0 lg:sticky lg:top-20 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                <h2 className="text-sm font-bold text-text flex items-center gap-2"><Receipt className="w-4 h-4" />الفاتورة</h2>
                <span className="text-xs text-subtext">{fmtInt(cart.length)} صنف</span>
              </div>
              {cart.length === 0 ? (
                <p className="text-sm text-subtext text-center py-10">لم تتم إضافة أصناف بعد</p>
              ) : (
                <ul className="divide-y divide-border/40">
                  {cart.map(l => (
                    <li key={l.key} className="px-4 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text">{l.product.name}</p>
                        {l.description && <p className="text-[11px] text-subtext">{l.description}</p>}
                        <p className="text-[11px] text-subtext tabular-nums">{fmtNum(l.quantity)} × {fmtMoney(l.unitPrice, currency)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-bold tabular-nums">{fmtMoney(l.unitPrice * l.quantity, currency)}</span>
                        <button onClick={() => setCart(c => c.filter(x => x.key !== l.key))} className="p-1 text-subtext hover:text-danger" aria-label="حذف">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="p-4 border-t border-border/50 space-y-3 bg-card2/40">
                <input value={customer} onChange={e => setCustomer(e.target.value)} className="eg-input !py-2" placeholder="اسم العميل (اختياري)" />
                <input value={notes} onChange={e => setNotes(e.target.value)} className="eg-input !py-2" placeholder="ملاحظات (اختياري)" />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-subtext">الإجمالي</span>
                  <span className="text-2xl font-extrabold text-text tabular-nums">{fmtMoney(total, currency)}</span>
                </div>
                <FormError message={error} />
                <button onClick={checkout} disabled={submitting || cart.length === 0} className="eg-btn-success w-full justify-center !py-3 !text-base">
                  {submitting ? "جاري تسجيل الفاتورة..." : error ? "إعادة المحاولة" : "إتمام البيع"}
                </button>
                <p className="text-[10px] text-subtext text-center">يتم التحقق من المخزون والأسعار وتسجيل الفاتورة والخصم في عملية واحدة</p>
              </div>
            </div>
          </div>
        </div>
      </AsyncBoundary>
    </>
  );
}
