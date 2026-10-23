import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus } from "lucide-react";
import PageHeader, { PageBody } from "@/core/ui/PageHeader";
import DataTable, { type Column } from "@/core/ui/DataTable";
import { AsyncBoundary } from "@/core/ui/States";
import { ActiveBadge, Badge } from "@/core/ui/Badges";
import { Field, FormError, Segmented, matchesStatus, statusOptions, type StatusFilter } from "@/core/ui/Form";
import Modal from "@/core/ui/Modal";
import { useAsync } from "@/core/hooks/useAsync";
import { useNotify } from "@/core/ui/Notifications";
import { useAuth } from "@/core/auth/AuthProvider";
import { errorMessage } from "@/core/lib/errors";
import { fmtInt, fmtNum } from "@/core/lib/format";
import { listStock } from "@/modules/inventory/api";
import { listBottleSizes, listOilTypes, listRules, saveOilType, type OilType } from "./api";

export default function OilTypesPage() {
  const data = useAsync(async () => {
    const [oils, stock, rules, sizes] = await Promise.all([listOilTypes(), listStock(), listRules(), listBottleSizes()]);
    return { oils, stock, rules, sizes: sizes.filter(s => s.active) };
  }, []);
  const { can } = useAuth();
  const notify = useNotify();
  const canEdit = can("perfume.configure");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [editing, setEditing] = useState<OilType | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [rulesFor, setRulesFor] = useState<OilType | null>(null);

  const stockOf = (o: OilType) => data.data?.stock.find(x => x.item_id === o.inventory_item_id);
  const rulesOf = (o: OilType) => (data.data?.rules ?? []).filter(r => r.oil_type_id === o.id);
  const rows = useMemo(() => (data.data?.oils ?? []).filter(o => matchesStatus(o.active, status)), [data.data, status]);

  const toggle = async (o: OilType) => {
    try {
      await saveOilType({ name: o.name, description: o.description, sort_order: o.sort_order, active: !o.active }, o.id);
      notify.success(o.active ? `تم إيقاف ${o.name}` : `تم تفعيل ${o.name}`);
      await data.reload();
    } catch (e) { notify.error(e); }
  };

  const columns: Column<OilType>[] = [
    { key: "name", header: "نوع الزيت", sortValue: o => o.name, render: o => (
      <div><p className="font-medium text-text">{o.name}</p>
        {o.description && <p className="text-[11px] text-subtext line-clamp-1">{o.description}</p>}</div>) },
    { key: "stock", header: "الرصيد (جرام)", sortValue: o => stockOf(o)?.quantity ?? 0, render: o => {
      const st = stockOf(o);
      if (!st) return "—";
      return <span className="inline-flex items-center gap-2 tabular-nums">{fmtNum(st.quantity)} جم{st.is_low && <Badge tone="warning">منخفض</Badge>}</span>;
    } },
    { key: "rules", header: "قواعد الاستهلاك", render: o => {
      const configured = rulesOf(o).filter(r => data.data?.sizes.some(s => s.id === r.bottle_size_id)).length;
      const total = data.data?.sizes.length ?? 0;
      return (
        <button onClick={() => setRulesFor(o)} className="inline-flex items-center gap-2 hover:underline">
          <Badge tone={configured >= total ? "success" : "warning"}>{fmtInt(configured)} / {fmtInt(total)} حجم</Badge>
          <span className="text-[11px] text-accent">عرض</span>
        </button>);
    } },
    { key: "status", header: "الحالة", sortValue: o => (o.active ? 0 : 1), render: o => <ActiveBadge active={o.active} /> },
    ...(canEdit ? [{ key: "actions", header: "", className: "w-32", render: (o: OilType) => (
      <div className="flex items-center gap-3 justify-end">
        <button onClick={() => { setEditing(o); setFormOpen(true); }} className="text-xs text-accent hover:underline inline-flex items-center gap-1">
          <Pencil className="w-3 h-3" />تعديل
        </button>
        <button onClick={() => toggle(o)} className={`text-xs hover:underline ${o.active ? "text-danger" : "text-success"}`}>
          {o.active ? "إيقاف" : "تفعيل"}
        </button>
      </div>) }] : []),
  ];

  return (
    <>
      <PageHeader title="أنواع الزيوت" count={data.data ? `${fmtInt(data.data.oils.length)} نوع` : undefined}
        subtitle="كل نوع مرتبط تلقائياً بصنف مخزون بالجرام"
        actions={canEdit && (
          <button onClick={() => { setEditing(null); setFormOpen(true); }} className="eg-btn-primary !py-1.5 !text-xs">
            <Plus className="w-3.5 h-3.5" />نوع زيت جديد
          </button>)} />
      <PageBody>
        <Segmented value={status} onChange={setStatus} options={statusOptions} />
        <AsyncBoundary loading={data.loading && !data.data} error={data.error} onRetry={data.reload}>
          <DataTable rows={rows} columns={columns} rowKey={o => o.id} emptyMessage="لا توجد أنواع زيوت"
            rowClassName={o => (o.active ? undefined : "opacity-60")} />
        </AsyncBoundary>
      </PageBody>

      {formOpen && (
        <OilForm oil={editing} onClose={() => setFormOpen(false)}
          onSaved={async () => { setFormOpen(false); notify.success("تم حفظ نوع الزيت"); await data.reload(); }} />
      )}

      {rulesFor && data.data && (
        <Modal open onClose={() => setRulesFor(null)} title={`قواعد استهلاك ${rulesFor.name}`}>
          <div className="space-y-3">
            <table className="w-full text-sm">
              <thead><tr className="text-subtext text-xs"><th className="text-right py-1.5">الحجم</th><th className="text-right py-1.5">جرام لكل زجاجة</th></tr></thead>
              <tbody>
                {data.data.sizes.map(s => {
                  const r = rulesOf(rulesFor).find(x => x.bottle_size_id === s.id);
                  return (
                    <tr key={s.id} className="border-t border-border/40">
                      <td className="py-2">{s.name}</td>
                      <td className="py-2 tabular-nums">{r ? `${fmtNum(r.grams_per_bottle)} جم` : <Badge tone="danger">غير محددة</Badge>}</td>
                    </tr>);
                })}
              </tbody>
            </table>
            <Link to={`/perfume/rules?oil=${rulesFor.id}`} className="eg-btn-ghost w-full justify-center !text-xs">فتح مصفوفة القواعد للتعديل</Link>
          </div>
        </Modal>
      )}
    </>
  );
}

function OilForm({ oil, onClose, onSaved }: { oil: OilType | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(oil?.name ?? "");
  const [description, setDescription] = useState(oil?.description ?? "");
  const [order, setOrder] = useState(oil?.sort_order ?? 0);
  const [active, setActive] = useState(oil?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!name.trim()) { setError("اسم نوع الزيت مطلوب"); return; }
    setSaving(true); setError("");
    try {
      await saveOilType({ name: name.trim(), description: description.trim() || null, sort_order: order, active }, oil?.id);
      onSaved();
    } catch (e) { setError(errorMessage(e)); setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={oil ? `تعديل ${oil.name}` : "نوع زيت جديد"}>
      <div className="space-y-4">
        <Field label="الاسم" required>
          <input value={name} onChange={e => setName(e.target.value)} className="eg-input" placeholder="مثال: فرنسي" autoFocus />
        </Field>
        <Field label="الوصف">
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="eg-input" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الترتيب">
            <input type="number" value={order} onChange={e => setOrder(Number(e.target.value) || 0)} className="eg-input" />
          </Field>
          <Field label="الحالة">
            <select value={active ? "1" : "0"} onChange={e => setActive(e.target.value === "1")} className="eg-select">
              <option value="1">مفعّل</option>
              <option value="0">متوقف</option>
            </select>
          </Field>
        </div>
        {!oil && (
          <p className="text-[11px] text-subtext bg-card2 rounded-lg p-3 leading-relaxed">
            سيتم إنشاء صنف مخزون "زيت {name || "…"}" بوحدة الجرام تلقائياً. لن يمكن بيع هذا الزيت حتى تُضاف قاعدة استهلاك وسعر لكل حجم.
          </p>
        )}
        <FormError message={error} />
        <button onClick={save} disabled={saving} className="eg-btn-primary w-full justify-center">
          {saving ? "جاري الحفظ..." : "حفظ"}
        </button>
      </div>
    </Modal>
  );
}
