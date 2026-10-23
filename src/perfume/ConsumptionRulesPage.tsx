import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import PageHeader, { PageBody } from "@/core/ui/PageHeader";
import { AsyncBoundary, EmptyState } from "@/core/ui/States";
import { Field, FormError, Segmented } from "@/core/ui/Form";
import Modal from "@/core/ui/Modal";
import { useAsync } from "@/core/hooks/useAsync";
import { useNotify } from "@/core/ui/Notifications";
import { useAuth } from "@/core/auth/AuthProvider";
import { useShop } from "@/core/settings/SettingsProvider";
import { errorMessage } from "@/core/lib/errors";
import { fmtInt, fmtMoney, fmtNum } from "@/core/lib/format";
import { cn } from "@/core/lib/cn";
import { listProducts } from "@/modules/catalog/api";
import {
  deletePrice, deleteRule, listBottleSizes, listOilTypes, listPrices, listRules, savePrice, saveRule,
  type BottleSize, type OilType,
} from "./api";

type Tab = "rules" | "prices";
type CellTarget = { oil: OilType; size: BottleSize };

export default function ConsumptionRulesPage() {
  const [params] = useSearchParams();
  const highlightOil = Number(params.get("oil")) || null;
  const [tab, setTab] = useState<Tab>("rules");
  const [priceScope, setPriceScope] = useState<number | null>(null); // null = default prices
  const { can } = useAuth();
  const { currency } = useShop();
  const notify = useNotify();
  const canEditRules = can("perfume.configure");
  const canEditPrices = can("prices.manage");

  const base = useAsync(async () => {
    const [oils, sizes, rules, products] = await Promise.all([listOilTypes(), listBottleSizes(), listRules(), listProducts()]);
    return {
      oils: oils.filter(o => o.active),
      sizes: sizes.filter(s => s.active),
      rules,
      formulations: products.filter(p => p.sale_mode === "perfume_formulation"),
    };
  }, []);
  const prices = useAsync(() => listPrices(priceScope), [priceScope]);
  const [cell, setCell] = useState<CellTarget | null>(null);

  const rule = (o: OilType, s: BottleSize) => base.data?.rules.find(r => r.oil_type_id === o.id && r.bottle_size_id === s.id);
  const price = (o: OilType, s: BottleSize, productId: number | null) =>
    prices.data?.find(p => p.oil_type_id === o.id && p.bottle_size_id === s.id && p.product_id === productId);

  const coverage = useMemo(() => {
    if (!base.data) return null;
    const total = base.data.oils.length * base.data.sizes.length;
    const missing: string[] = [];
    base.data.oils.forEach(o => base.data!.sizes.forEach(s => { if (!rule(o, s)) missing.push(`${o.name} × ${s.name}`); }));
    return { total, configured: total - missing.length, missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.data]);

  const priceCoverage = useMemo(() => {
    if (!base.data || !prices.data) return null;
    let missing = 0;
    base.data.oils.forEach(o => base.data!.sizes.forEach(s => { if (!price(o, s, null) && !(priceScope && price(o, s, priceScope))) missing++; }));
    return missing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.data, prices.data, priceScope]);

  const editable = tab === "rules" ? canEditRules : canEditPrices;

  return (
    <>
      <PageHeader title="قواعد استهلاك الزيت والأسعار"
        subtitle="كم جرام من كل نوع زيت يُستهلك لكل حجم زجاجة، وسعر بيع كل اختيار" />
      <PageBody>
        <Segmented value={tab} onChange={setTab} options={[
          { value: "rules", label: "استهلاك الزيت (جم / زجاجة)" },
          { value: "prices", label: "أسعار البيع" },
        ]} />

        <AsyncBoundary loading={base.loading && !base.data} error={base.error} onRetry={base.reload}>
          {base.data && (base.data.oils.length === 0 || base.data.sizes.length === 0) ? (
            <div className="eg-card"><EmptyState message="أضف أحجام زجاجات وأنواع زيوت مفعّلة أولاً" /></div>
          ) : base.data && (
            <>
              {tab === "rules" && coverage && (
                <div className={cn("eg-card !p-4 flex items-start gap-3",
                  coverage.missing.length ? "border-warning/40" : "border-success/40")}>
                  {coverage.missing.length
                    ? <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                    : <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />}
                  <div className="text-sm">
                    <p className="text-text font-semibold">
                      {fmtInt(coverage.configured)} من {fmtInt(coverage.total)} قاعدة محددة
                    </p>
                    {coverage.missing.length > 0 ? (
                      <p className="text-xs text-subtext mt-1 leading-relaxed">
                        هذه الاختيارات لا يمكن بيعها حتى تُحدد قاعدتها: {coverage.missing.join("، ")}
                      </p>
                    ) : <p className="text-xs text-subtext mt-1">كل التركيبات المفعّلة لها قاعدة استهلاك.</p>}
                  </div>
                </div>
              )}

              {tab === "prices" && (
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="الأسعار المعروضة" className="w-full sm:w-72">
                    <select value={priceScope ?? ""} onChange={e => setPriceScope(e.target.value ? Number(e.target.value) : null)} className="eg-select">
                      <option value="">الأسعار الافتراضية (لكل التركيبات)</option>
                      {base.data.formulations.map(p => <option key={p.id} value={p.id}>سعر خاص: {p.name}</option>)}
                    </select>
                  </Field>
                  {priceCoverage != null && priceCoverage > 0 && (
                    <p className="text-xs text-warning flex items-center gap-1.5 pb-2">
                      <AlertTriangle className="w-3.5 h-3.5" />{fmtInt(priceCoverage)} اختيار بدون سعر — لن يمكن بيعه
                    </p>
                  )}
                </div>
              )}

              <div className="eg-card !p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="eg-table">
                    <thead>
                      <tr>
                        <th className="sticky right-0 z-[1]">نوع الزيت \ الحجم</th>
                        {base.data.sizes.map(s => <th key={s.id} className="text-center">{s.name}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {base.data.oils.map(o => (
                        <tr key={o.id} className={cn(highlightOil === o.id && "ring-1 ring-inset ring-accent/50")}>
                          <td className="sticky right-0 bg-card font-semibold text-text whitespace-nowrap">{o.name}</td>
                          {base.data!.sizes.map(s => (
                            <td key={s.id} className="!p-1.5 text-center">
                              {tab === "rules"
                                ? <RuleCell grams={rule(o, s)?.grams_per_bottle} editable={editable} onClick={() => setCell({ oil: o, size: s })} />
                                : <PriceCell currency={currency} editable={editable}
                                    own={priceScope ? price(o, s, priceScope)?.price : price(o, s, null)?.price}
                                    fallback={priceScope ? price(o, s, null)?.price : undefined}
                                    hasRule={!!rule(o, s)}
                                    onClick={() => setCell({ oil: o, size: s })} />}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="text-[11px] text-subtext">
                {tab === "rules"
                  ? "تعديل قاعدة يؤثر على المبيعات الجديدة فقط؛ الكميات المسجلة في الفواتير السابقة لا تتغير."
                  : priceScope ? "الخانات الباهتة تعرض السعر الافتراضي؛ أضف سعراً خاصاً لاستبداله لهذا المنتج فقط." : "السعر الافتراضي يُطبق على كل التركيبات ما لم يُحدد سعر خاص للمنتج."}
              </p>
            </>
          )}
        </AsyncBoundary>
      </PageBody>

      {cell && tab === "rules" && (
        <RuleEditor target={cell} existing={rule(cell.oil, cell.size)} onClose={() => setCell(null)}
          onSaved={async msg => { setCell(null); notify.success(msg); await base.reload(); }} />
      )}
      {cell && tab === "prices" && (
        <PriceEditor target={cell} currency={currency}
          productName={priceScope ? base.data?.formulations.find(p => p.id === priceScope)?.name ?? null : null}
          productId={priceScope} existing={price(cell.oil, cell.size, priceScope)}
          fallback={priceScope ? price(cell.oil, cell.size, null)?.price : undefined}
          onClose={() => setCell(null)}
          onSaved={async msg => { setCell(null); notify.success(msg); await prices.reload(); }} />
      )}
    </>
  );
}

function RuleCell({ grams, editable, onClick }: { grams?: number; editable: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!editable}
      className={cn("w-full min-w-[5.5rem] rounded-lg px-2 py-2 text-xs tabular-nums transition-colors disabled:cursor-default",
        grams != null ? "bg-card2 text-text hover:bg-border" : "bg-danger/10 text-danger border border-dashed border-danger/40 hover:bg-danger/20")}>
      {grams != null ? `${fmtNum(grams)} جم` : "غير محددة"}
    </button>
  );
}

function PriceCell({ own, fallback, hasRule, currency, editable, onClick }: {
  own?: number; fallback?: number; hasRule: boolean; currency: string; editable: boolean; onClick: () => void;
}) {
  const value = own ?? fallback;
  return (
    <button type="button" onClick={onClick} disabled={!editable}
      title={hasRule ? undefined : "لا توجد قاعدة استهلاك لهذا الاختيار"}
      className={cn("w-full min-w-[6rem] rounded-lg px-2 py-2 text-xs tabular-nums transition-colors disabled:cursor-default",
        own != null ? "bg-card2 text-text hover:bg-border"
          : value != null ? "bg-card2/40 text-subtext hover:bg-border"
          : "bg-danger/10 text-danger border border-dashed border-danger/40 hover:bg-danger/20",
        !hasRule && "opacity-50")}>
      {value != null ? fmtMoney(value, currency) : "بدون سعر"}
    </button>
  );
}

function RuleEditor({ target, existing, onClose, onSaved }: {
  target: CellTarget; existing?: { id: number; grams_per_bottle: number };
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [grams, setGrams] = useState(existing ? String(existing.grams_per_bottle) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = `زيت ${target.oil.name} × ${target.size.name}`;

  const save = async () => {
    const g = Number(grams);
    if (!(g > 0)) { setError("الكمية يجب أن تكون أكبر من صفر"); return; }
    setBusy(true); setError("");
    try { await saveRule(target.oil.id, target.size.id, g, existing?.id); onSaved(`تم حفظ قاعدة ${label}`); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  const remove = async () => {
    if (!existing) return;
    setBusy(true); setError("");
    try { await deleteRule(existing.id); onSaved(`تم حذف قاعدة ${label}`); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={label} size="sm">
      <div className="space-y-4">
        <Field label="جرام زيت لكل زجاجة" required hint={`حجم الزجاجة ${fmtNum(target.size.volume_ml, 2)} مل — الجرام ليس مساوياً للمل`}>
          <input type="number" min={0} step="0.001" value={grams} onChange={e => setGrams(e.target.value)} className="eg-input" autoFocus
            onKeyDown={e => e.key === "Enter" && save()} />
        </Field>
        <FormError message={error} />
        <div className="flex gap-2">
          <button onClick={save} disabled={busy} className="eg-btn-primary flex-1 justify-center">{busy ? "جاري الحفظ..." : "حفظ"}</button>
          {existing && <button onClick={remove} disabled={busy} className="eg-btn-ghost text-danger">حذف القاعدة</button>}
        </div>
        {existing && <p className="text-[11px] text-subtext">الحذف مسموح فقط إذا لم تُستخدم القاعدة في أي فاتورة.</p>}
      </div>
    </Modal>
  );
}

function PriceEditor({ target, productId, productName, existing, fallback, currency, onClose, onSaved }: {
  target: CellTarget; productId: number | null; productName: string | null;
  existing?: { id: number; price: number }; fallback?: number; currency: string;
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [value, setValue] = useState(existing ? String(existing.price) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = `${target.size.name} · زيت ${target.oil.name}`;

  const save = async () => {
    const p = Number(value);
    if (value === "" || !(p >= 0)) { setError("أدخل سعراً صحيحاً"); return; }
    setBusy(true); setError("");
    try { await savePrice(productId, target.size.id, target.oil.id, p, existing?.id); onSaved(`تم حفظ سعر ${label}`); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    try { await deletePrice(existing.id); onSaved(`تم حذف سعر ${label}`); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={productName ? `سعر خاص لـ ${productName}` : "السعر الافتراضي"} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-text">{label}</p>
        <Field label={`سعر البيع${currency ? ` (${currency})` : ""}`} required
          hint={productId && fallback != null ? `السعر الافتراضي: ${fmtMoney(fallback, currency)}` : undefined}>
          <input type="number" min={0} step="0.01" value={value} onChange={e => setValue(e.target.value)} className="eg-input" autoFocus
            onKeyDown={e => e.key === "Enter" && save()} />
        </Field>
        <FormError message={error} />
        <div className="flex gap-2">
          <button onClick={save} disabled={busy} className="eg-btn-primary flex-1 justify-center">{busy ? "جاري الحفظ..." : "حفظ"}</button>
          {existing && (
            <button onClick={remove} disabled={busy} className="eg-btn-ghost text-danger">
              {productId ? "إلغاء السعر الخاص" : "حذف السعر"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
