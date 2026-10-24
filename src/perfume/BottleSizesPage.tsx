import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import ConfirmDialog from "@/core/ui/ConfirmDialog";
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
import { deleteBottleSize, listBottleSizes, listOilTypes, listRules, saveBottleSize, type BottleSize } from "./api";

export default function BottleSizesPage() {
  const data = useAsync(async () => {
    const [sizes, stock, rules, oils] = await Promise.all([listBottleSizes(), listStock(), listRules(), listOilTypes()]);
    return { sizes, stock, rules, activeOils: oils.filter(o => o.active).length };
  }, []);
  const { can } = useAuth();
  const notify = useNotify();
  const canEdit = can("perfume.configure");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [editing, setEditing] = useState<BottleSize | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<BottleSize | null>(null);

  const stockOf = (s: BottleSize) => data.data?.stock.find(x => x.item_id === s.inventory_item_id);
  const rulesOf = (s: BottleSize) => data.data?.rules.filter(r => r.bottle_size_id === s.id).length ?? 0;
  const rows = useMemo(() => (data.data?.sizes ?? []).filter(s => matchesStatus(s.active, status)), [data.data, status]);

  const toggle = async (s: BottleSize) => {
    try {
      await saveBottleSize({ name: s.name, volume_ml: s.volume_ml, sort_order: s.sort_order, active: !s.active }, s.id);
      notify.success(s.active ? `تم إيقاف الحجم ${s.name}` : `تم تفعيل الحجم ${s.name}`);
      await data.reload();
    } catch (e) { notify.error(e); }
  };

  const columns: Column<BottleSize>[] = [
    { key: "name", header: "الحجم", sortValue: s => s.name, render: s => <span className="font-medium text-text">{s.name}</span> },
    { key: "ml", header: "السعة (مل)", sortValue: s => s.volume_ml, render: s => <span className="tabular-nums">{fmtNum(s.volume_ml, 2)}</span> },
    { key: "stock", header: "زجاجات فارغة بالمخزون", sortValue: s => stockOf(s)?.quantity ?? 0, render: s => {
      const st = stockOf(s);
      if (!st) return "—";
      return <span className="inline-flex items-center gap-2 tabular-nums">{fmtInt(st.quantity)} قطعة{st.is_low && <Badge tone="warning">منخفض</Badge>}</span>;
    } },
    { key: "rules", header: "قواعد الاستهلاك", render: s => {
      const n = rulesOf(s), total = data.data?.activeOils ?? 0;
      return <Badge tone={n >= total ? "success" : "warning"}>{fmtInt(n)} / {fmtInt(total)} زيت</Badge>;
    } },
    { key: "status", header: "الحالة", sortValue: s => (s.active ? 0 : 1), render: s => <ActiveBadge active={s.active} /> },
    ...(canEdit ? [{ key: "actions", header: "", className: "w-32", render: (s: BottleSize) => (
      <div className="flex items-center gap-3 justify-end">
        <button onClick={() => { setEditing(s); setFormOpen(true); }} className="text-xs text-accent hover:underline inline-flex items-center gap-1">
          <Pencil className="w-3 h-3" />تعديل
        </button>
        <button onClick={() => toggle(s)} className={`text-xs hover:underline ${s.active ? "text-danger" : "text-success"}`}>
          {s.active ? "إيقاف" : "تفعيل"}
        </button>
        <button onClick={() => setToDelete(s)} className="text-xs text-danger hover:underline inline-flex items-center gap-1">
          <Trash2 className="w-3 h-3" />حذف
        </button>
      </div>) }] : []),
  ];

  return (
    <>
      <PageHeader title="أحجام الزجاجات" count={data.data ? `${fmtInt(data.data.sizes.length)} حجم` : undefined}
        subtitle="كل حجم مرتبط تلقائياً بصنف مخزون للزجاجات الفارغة (بالقطعة)"
        actions={canEdit && (
          <button onClick={() => { setEditing(null); setFormOpen(true); }} className="eg-btn-primary !py-1.5 !text-xs">
            <Plus className="w-3.5 h-3.5" />حجم جديد
          </button>)} />
      <PageBody>
        <Segmented value={status} onChange={setStatus} options={statusOptions} />
        <AsyncBoundary loading={data.loading && !data.data} error={data.error} onRetry={data.reload}>
          <DataTable rows={rows} columns={columns} rowKey={s => s.id} emptyMessage="لا توجد أحجام"
            rowClassName={s => (s.active ? undefined : "opacity-60")} />
        </AsyncBoundary>
      </PageBody>
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} title="حذف حجم الزجاجة" confirmLabel="حذف"
        message={toDelete ? `حذف الحجم "${toDelete.name}" مع قواعد الاستهلاك والأسعار الخاصة به وصنف الزجاجات الفارغة؟ لا يمكن الحذف إذا سُجلت عليه مبيعات أو حركات مخزون، وفي هذه الحالة استخدم الإيقاف.` : ""}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteBottleSize(toDelete.id);
          notify.success(`تم حذف ${toDelete.name}`);
          setToDelete(null);
          await data.reload();
        }} />
      {formOpen && (
        <SizeForm size={editing} onClose={() => setFormOpen(false)}
          onSaved={async () => { setFormOpen(false); notify.success("تم حفظ الحجم"); await data.reload(); }} />
      )}
    </>
  );
}

function SizeForm({ size, onClose, onSaved }: { size: BottleSize | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(size?.name ?? "");
  const [ml, setMl] = useState(size ? String(size.volume_ml) : "");
  const [order, setOrder] = useState(size?.sort_order ?? 0);
  const [active, setActive] = useState(size?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    const volume = Number(ml);
    if (!name.trim()) { setError("اسم الحجم مطلوب"); return; }
    if (!(volume > 0)) { setError("السعة يجب أن تكون أكبر من صفر"); return; }
    setSaving(true); setError("");
    try {
      await saveBottleSize({ name: name.trim(), volume_ml: volume, sort_order: order, active }, size?.id);
      onSaved();
    } catch (e) { setError(errorMessage(e)); setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={size ? `تعديل ${size.name}` : "حجم زجاجة جديد"}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="اسم العرض" required>
            <input value={name} onChange={e => setName(e.target.value)} className="eg-input" placeholder="مثال: 50 مل" autoFocus />
          </Field>
          <Field label="السعة الاسمية (مل)" required>
            <input type="number" min={0} step="0.01" value={ml} onChange={e => setMl(e.target.value)} className="eg-input"
              onBlur={() => { if (!name.trim() && Number(ml) > 0) setName(`${Number(ml)} مل`); }} />
          </Field>
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
        {!size && (
          <p className="text-[11px] text-subtext bg-card2 rounded-lg p-3 leading-relaxed">
            سيتم إنشاء صنف مخزون "زجاجة فارغة {name || "…"}" تلقائياً. بعد الحفظ أضف قواعد استهلاك الزيت وأسعار البيع لهذا الحجم من صفحة قواعد الاستهلاك.
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
