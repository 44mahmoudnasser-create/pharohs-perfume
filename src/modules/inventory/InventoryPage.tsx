import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardCheck, PackagePlus, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import ConfirmDialog from "@/core/ui/ConfirmDialog";
import PageHeader, { PageBody } from "@/core/ui/PageHeader";
import DataTable, { type Column } from "@/core/ui/DataTable";
import { AsyncBoundary, EmptyState } from "@/core/ui/States";
import { ActiveBadge, Badge } from "@/core/ui/Badges";
import { Field, FilterSelect, FormError, SearchInput, Segmented } from "@/core/ui/Form";
import Modal from "@/core/ui/Modal";
import Pagination from "@/core/ui/Pagination";
import { useAsync } from "@/core/hooks/useAsync";
import { useNotify } from "@/core/ui/Notifications";
import { useAuth } from "@/core/auth/AuthProvider";
import { errorMessage } from "@/core/lib/errors";
import { cn } from "@/core/lib/cn";
import { fmtDateTime, fmtQty, UNIT_LABEL } from "@/core/lib/format";
import {
  GROUP_LABEL, MOVEMENT_LABEL, adjustStock, deleteItem, listMovements, listStock, receiveStock, recordCount, saveItem,
  type ItemGroup, type ItemInput, type StockRow, type Unit,
} from "./api";

type Tab = "stock" | "movements";
type Op = { kind: "receipt" | "adjust" | "count"; row: StockRow };

export default function InventoryPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("stock");
  return (
    <>
      <PageHeader title="المخزون" subtitle="الأرصدة محسوبة من سجل الحركات (رصيد دفتري) — سجّل الجرد الفعلي لتصحيح الفروق" />
      <PageBody>
        {can("inventory.history") && (
          <Segmented value={tab} onChange={setTab} options={[
            { value: "stock", label: "الأرصدة" }, { value: "movements", label: "سجل الحركات" },
          ]} />
        )}
        {tab === "stock" ? <StockTab /> : <MovementsTab />}
      </PageBody>
    </>
  );
}

function StockTab() {
  const stock = useAsync(listStock, []);
  const { can } = useAuth();
  const notify = useNotify();
  const canManage = can("inventory.manage");
  const [group, setGroup] = useState<"all" | ItemGroup>("all");
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [op, setOp] = useState<Op | null>(null);
  const [itemForm, setItemForm] = useState<{ row: StockRow | null } | null>(null);
  const [deleteRow, setDeleteRow] = useState<StockRow | null>(null);

  const rows = useMemo(() => (stock.data ?? []).filter(r =>
    (group === "all" || r.item_group === group) && (!lowOnly || (r.is_low && r.active)) &&
    (!search || r.name.includes(search) || (r.sku ?? "").toLowerCase().includes(search.toLowerCase()))),
  [stock.data, group, search, lowOnly]);
  const lowCount = (stock.data ?? []).filter(r => r.is_low && r.active).length;

  const columns: Column<StockRow>[] = [
    { key: "name", header: "الصنف", sortValue: r => r.name, render: r => (
      <div>
        <p className="font-medium text-text">{r.name}</p>
        <p className="text-[11px] text-subtext">
          {r.oil_type_name ? `مرتبط بنوع الزيت ${r.oil_type_name}` : r.bottle_size_name ? `مرتبط بحجم ${r.bottle_size_name}` : r.sku ?? ""}
        </p>
      </div>) },
    { key: "group", header: "المجموعة", sortValue: r => r.item_group, render: r => <span className="text-xs">{GROUP_LABEL[r.item_group]}</span> },
    { key: "qty", header: "الرصيد", sortValue: r => Number(r.quantity), render: r => (
      <span className={cn("tabular-nums font-semibold", Number(r.quantity) < 0 ? "text-danger" : r.is_low ? "text-warning" : "text-text")}>
        {fmtQty(r.quantity, r.unit)}
      </span>) },
    { key: "reorder", header: "حد الطلب", sortValue: r => Number(r.reorder_level), render: r => <span className="tabular-nums text-subtext text-xs">{fmtQty(r.reorder_level, r.unit)}</span> },
    { key: "state", header: "الحالة", render: r => !r.active ? <ActiveBadge active={false} />
        : Number(r.quantity) < 0 ? <Badge tone="danger">بالسالب</Badge>
        : r.is_low ? <Badge tone="warning">منخفض</Badge> : <Badge tone="success">جيد</Badge> },
    { key: "last", header: "آخر حركة", sortValue: r => r.last_movement_at ?? "", render: r => <span className="text-[11px] text-subtext whitespace-nowrap">{fmtDateTime(r.last_movement_at)}</span> },
    ...(canManage ? [{ key: "actions", header: "", render: (r: StockRow) => (
      <div className="flex items-center gap-3 justify-end whitespace-nowrap">
        <button onClick={() => setOp({ kind: "receipt", row: r })} disabled={!r.active} className="text-xs text-success hover:underline disabled:opacity-40 inline-flex items-center gap-1">
          <PackagePlus className="w-3 h-3" />استلام
        </button>
        <button onClick={() => setOp({ kind: "adjust", row: r })} className="text-xs text-warning hover:underline inline-flex items-center gap-1">
          <SlidersHorizontal className="w-3 h-3" />تسوية
        </button>
        <button onClick={() => setOp({ kind: "count", row: r })} className="text-xs text-accent hover:underline inline-flex items-center gap-1">
          <ClipboardCheck className="w-3 h-3" />جرد
        </button>
        <button onClick={() => setItemForm({ row: r })} className="text-xs text-subtext hover:text-text" aria-label="تعديل الصنف">
          <Pencil className="w-3 h-3" />
        </button>
        {!(r.oil_type_id || r.bottle_size_id) && (
          <button onClick={() => setDeleteRow(r)} className="text-xs text-danger hover:text-danger/80" aria-label="حذف الصنف">
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>) }] : []),
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="بحث باسم الصنف أو الكود" className="w-full sm:w-64" />
        <FilterSelect value={group} onChange={setGroup}
          options={[{ value: "all", label: "كل المجموعات" }, ...(Object.keys(GROUP_LABEL) as ItemGroup[]).map(g => ({ value: g, label: GROUP_LABEL[g] }))]} />
        <button onClick={() => setLowOnly(v => !v)}
          className={cn("px-3 py-1.5 rounded-lg text-xs border", lowOnly ? "border-warning bg-warning/15 text-warning" : "border-border text-subtext")}>
          المنخفض فقط ({lowCount})
        </button>
        {canManage && (
          <button onClick={() => setItemForm({ row: null })} className="eg-btn-ghost !py-1.5 !text-xs mr-auto">
            <Plus className="w-3.5 h-3.5" />صنف مخزون جديد
          </button>
        )}
      </div>
      <AsyncBoundary loading={stock.loading && !stock.data} error={stock.error} onRetry={stock.reload}>
        <DataTable rows={rows} columns={columns} rowKey={r => r.item_id} pageSize={50} emptyMessage="لا توجد أصناف مطابقة"
          rowClassName={r => (r.active ? undefined : "opacity-60")} />
      </AsyncBoundary>

      {op && (
        <StockOperationModal op={op} onClose={() => setOp(null)}
          onDone={async msg => { setOp(null); notify.success(msg); await stock.reload(); }} />
      )}
      <ConfirmDialog open={!!deleteRow} onClose={() => setDeleteRow(null)} title="حذف صنف المخزون" confirmLabel="حذف"
        message={deleteRow ? `حذف "${deleteRow.name}" نهائياً؟ لا يمكن الحذف إذا كان له حركات مخزون، وفي هذه الحالة استخدم الإيقاف من التعديل.` : ""}
        onConfirm={async () => {
          if (!deleteRow) return;
          await deleteItem(deleteRow.item_id);
          notify.success(`تم حذف ${deleteRow.name}`);
          setDeleteRow(null);
          await stock.reload();
        }} />
      {itemForm && (
        <ItemFormModal row={itemForm.row} onClose={() => setItemForm(null)}
          onSaved={async () => { setItemForm(null); notify.success("تم حفظ الصنف"); await stock.reload(); }} />
      )}
    </>
  );
}

function StockOperationModal({ op, onClose, onDone }: { op: Op; onClose: () => void; onDone: (msg: string) => void }) {
  const { row, kind } = op;
  const [qty, setQty] = useState("");
  const [direction, setDirection] = useState<"plus" | "minus" | "waste">("minus");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unit = UNIT_LABEL[row.unit];

  const title = { receipt: "استلام كمية", adjust: "تسوية رصيد", count: "تسجيل جرد فعلي" }[kind];

  const submit = async () => {
    const n = Number(qty);
    setError("");
    if (qty === "" || !(n >= 0) || (kind !== "count" && n === 0)) { setError("أدخل كمية صحيحة"); return; }
    if (row.unit === "pcs" && !Number.isInteger(n)) { setError("الزجاجات والقطع تُسجل بأرقام صحيحة"); return; }
    if (kind === "adjust" && !note.trim()) { setError("سبب التسوية مطلوب"); return; }
    setBusy(true);
    try {
      if (kind === "receipt") {
        await receiveStock(row.item_id, n, note.trim());
        onDone(`تم استلام ${fmtQty(n, row.unit)} من ${row.name}`);
      } else if (kind === "adjust") {
        const delta = direction === "plus" ? n : -n;
        await adjustStock(row.item_id, delta, note.trim(), direction === "waste" ? "waste" : "adjustment");
        onDone(`تم تسجيل التسوية على ${row.name}`);
      } else {
        const id = await recordCount(row.item_id, n, note.trim());
        onDone(id ? `تم تسجيل الجرد وتصحيح الفرق لـ ${row.name}` : `الجرد مطابق للرصيد الدفتري لـ ${row.name}`);
      }
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`${title} — ${row.name}`} size="sm">
      <div className="space-y-4">
        <div className="bg-card2 rounded-lg px-3 py-2 flex items-center justify-between text-sm">
          <span className="text-subtext">الرصيد الدفتري الحالي</span>
          <span className="font-bold tabular-nums">{fmtQty(row.quantity, row.unit)}</span>
        </div>
        {kind === "adjust" && (
          <Segmented value={direction} onChange={setDirection} options={[
            { value: "minus", label: "نقص" }, { value: "plus", label: "زيادة" }, { value: "waste", label: "تالف / انسكاب" },
          ]} />
        )}
        <Field label={kind === "count" ? `الكمية الموجودة فعلياً (${unit})` : `الكمية (${unit})`} required
          hint={row.unit === "g" ? "الزيت يُسجل بالجرام (وليس بالمل)" : undefined}>
          <input type="number" min={0} step={row.unit === "pcs" ? 1 : 0.001} value={qty} onChange={e => setQty(e.target.value)} className="eg-input" autoFocus />
        </Field>
        {kind === "count" && qty !== "" && Number(qty) >= 0 && (
          <p className="text-xs text-subtext">
            الفرق المسجل: <span className="tabular-nums text-text">{fmtQty(Number(qty) - Number(row.quantity), row.unit)}</span>
          </p>
        )}
        <Field label={kind === "adjust" ? "السبب" : "ملاحظة"} required={kind === "adjust"}>
          <input value={note} onChange={e => setNote(e.target.value)} className="eg-input"
            placeholder={kind === "receipt" ? "مثال: فاتورة مورد رقم ..." : kind === "adjust" ? "مثال: زجاجة مكسورة" : ""} />
        </Field>
        <FormError message={error} />
        <button onClick={submit} disabled={busy} className="eg-btn-primary w-full justify-center">{busy ? "جاري الحفظ..." : "تسجيل"}</button>
      </div>
    </Modal>
  );
}

function ItemFormModal({ row, onClose, onSaved }: { row: StockRow | null; onClose: () => void; onSaved: () => void }) {
  const linked = !!(row?.oil_type_id || row?.bottle_size_id);
  const [form, setForm] = useState<ItemInput>({
    name: row?.name ?? "", sku: row?.sku ?? "", unit: row?.unit ?? "pcs", item_group: row?.item_group ?? "merchandise",
    reorder_level: row ? Number(row.reorder_level) : 0, notes: null, active: row?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof ItemInput>(k: K, v: ItemInput[K]) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { setError("اسم الصنف مطلوب"); return; }
    if (!(form.reorder_level >= 0)) { setError("حد الطلب لا يمكن أن يكون سالباً"); return; }
    setBusy(true); setError("");
    try {
      // linked items: name/unit/active are owned by the bottle size / oil type
      const input: Partial<ItemInput> = linked
        ? { sku: form.sku?.trim() || null, reorder_level: form.reorder_level }
        : { name: form.name.trim(), sku: form.sku?.trim() || null, unit: form.unit, item_group: form.item_group,
            reorder_level: form.reorder_level, active: form.active };
      if (row) delete input.unit;
      await saveItem(input, row?.item_id);
      onSaved();
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={row ? `تعديل ${row.name}` : "صنف مخزون جديد"}>
      <div className="space-y-4">
        {linked && <p className="text-[11px] text-subtext bg-card2 rounded-lg p-3">هذا الصنف مرتبط بحجم زجاجة أو نوع زيت؛ الاسم والحالة يُعدلان من صفحة الإعداد الخاصة به.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="الاسم" required>
            <input value={form.name} onChange={e => set("name", e.target.value)} className="eg-input" disabled={linked} />
          </Field>
          <Field label="الكود (SKU)">
            <input value={form.sku ?? ""} onChange={e => set("sku", e.target.value)} className="eg-input font-mono" dir="ltr" />
          </Field>
          <Field label="الوحدة" required hint={row ? "لا يمكن تغيير الوحدة بعد الإنشاء" : undefined}>
            <select value={form.unit} onChange={e => set("unit", e.target.value as Unit)} className="eg-select" disabled={!!row}>
              <option value="pcs">قطعة</option><option value="g">جرام</option><option value="ml">مل</option>
            </select>
          </Field>
          <Field label="المجموعة">
            <select value={form.item_group} onChange={e => set("item_group", e.target.value as ItemGroup)} className="eg-select" disabled={linked}>
              {(Object.keys(GROUP_LABEL) as ItemGroup[]).map(g => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
            </select>
          </Field>
          <Field label="حد إعادة الطلب" hint="يظهر الصنف كمنخفض عند الوصول لهذا الرصيد">
            <input type="number" min={0} step="0.001" value={form.reorder_level} onChange={e => set("reorder_level", Number(e.target.value))} className="eg-input" />
          </Field>
          {!linked && (
            <Field label="الحالة">
              <select value={form.active ? "1" : "0"} onChange={e => set("active", e.target.value === "1")} className="eg-select">
                <option value="1">مفعّل</option><option value="0">متوقف</option>
              </select>
            </Field>
          )}
        </div>
        {!row && <p className="text-[11px] text-subtext">الرصيد يبدأ بصفر؛ سجّل "استلام" لإضافة الكمية الافتتاحية.</p>}
        <FormError message={error} />
        <button onClick={save} disabled={busy} className="eg-btn-primary w-full justify-center">{busy ? "جاري الحفظ..." : "حفظ"}</button>
      </div>
    </Modal>
  );
}

const PAGE_SIZE = 50;

function MovementsTab() {
  const stock = useAsync(listStock, []);
  const [itemId, setItemId] = useState("all");
  const [type, setType] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const filter = { itemId: itemId === "all" ? null : Number(itemId), type: type === "all" ? null : type, from: from || null, to: to || null };
  const movements = useAsync(() => listMovements(filter, page, PAGE_SIZE),
    [itemId, type, from, to, page]);
  const pages = Math.max(1, Math.ceil((movements.data?.total ?? 0) / PAGE_SIZE));
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <FilterSelect value={itemId} onChange={resetPage(setItemId)}
          options={[{ value: "all", label: "كل الأصناف" }, ...(stock.data ?? []).map(s => ({ value: String(s.item_id), label: s.name }))]} />
        <FilterSelect value={type} onChange={resetPage(setType)}
          options={[{ value: "all", label: "كل الأنواع" }, ...Object.entries(MOVEMENT_LABEL).map(([value, label]) => ({ value, label }))]} />
        <div><label className="eg-label">من</label><input type="date" value={from} onChange={e => resetPage(setFrom)(e.target.value)} className="eg-input !py-1.5 !text-xs" /></div>
        <div><label className="eg-label">إلى</label><input type="date" value={to} onChange={e => resetPage(setTo)(e.target.value)} className="eg-input !py-1.5 !text-xs" /></div>
      </div>
      <AsyncBoundary loading={movements.loading && !movements.data} error={movements.error} onRetry={movements.reload}>
        {movements.data && movements.data.rows.length === 0 ? <div className="eg-card"><EmptyState message="لا توجد حركات" /></div> : (
          <div className="eg-card !p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="eg-table">
                <thead><tr><th>التاريخ</th><th>الصنف</th><th>النوع</th><th>الكمية</th><th>الرصيد بعد</th><th>المرجع</th><th>ملاحظة</th></tr></thead>
                <tbody>
                  {(movements.data?.rows ?? []).map(m => (
                    <tr key={m.id}>
                      <td className="text-[11px] whitespace-nowrap">{fmtDateTime(m.created_at)}</td>
                      <td className="text-xs">{m.item?.name}</td>
                      <td><Badge tone={m.quantity > 0 ? "success" : "danger"}>{MOVEMENT_LABEL[m.movement_type] ?? m.movement_type}</Badge></td>
                      <td className={cn("tabular-nums text-xs font-semibold whitespace-nowrap", m.quantity > 0 ? "text-success" : "text-danger")} dir="ltr">
                        {m.quantity > 0 ? "+" : ""}{fmtQty(m.quantity, m.unit)}
                      </td>
                      <td className="tabular-nums text-xs whitespace-nowrap">{fmtQty(m.balance_after, m.unit)}</td>
                      <td className="text-xs">
                        {m.reference_type === "sale" && m.reference_id
                          ? <Link to={`/sales?open=${m.reference_id}`} className="text-accent hover:underline font-mono">فاتورة #{m.reference_id}</Link>
                          : "—"}
                      </td>
                      <td className="text-[11px] text-subtext max-w-[14rem] truncate">{m.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border/50 px-4 py-2">
              <Pagination page={page} pageCount={pages} total={movements.data?.total} onChange={setPage} />
            </div>
          </div>
        )}
      </AsyncBoundary>
    </>
  );
}
