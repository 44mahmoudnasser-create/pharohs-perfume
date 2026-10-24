import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import PageHeader, { PageBody } from "@/core/ui/PageHeader";
import DataTable, { type Column } from "@/core/ui/DataTable";
import { AsyncBoundary } from "@/core/ui/States";
import { ActiveBadge, Badge } from "@/core/ui/Badges";
import { Field, FormError, SearchInput, Segmented, matchesStatus, statusOptions, type StatusFilter } from "@/core/ui/Form";
import Modal from "@/core/ui/Modal";
import ConfirmDialog from "@/core/ui/ConfirmDialog";
import { useAsync } from "@/core/hooks/useAsync";
import { useNotify } from "@/core/ui/Notifications";
import { useAuth } from "@/core/auth/AuthProvider";
import { errorMessage } from "@/core/lib/errors";
import { fmtInt } from "@/core/lib/format";
import { useSaleModes } from "@/modules/sales/saleModes";
import { deleteCategory, listCategories, saveCategory, setCategoryActive, type Category, type CategoryInput } from "./api";

const empty: CategoryInput = { name: "", description: "", sort_order: 0, active: true, sale_mode: "stock_item" };

export default function CategoriesPage() {
  const { data, loading, error, reload } = useAsync(listCategories, []);
  const { can } = useAuth();
  const notify = useNotify();
  const saleModes = useSaleModes();
  const canManage = can("catalog.manage");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [editing, setEditing] = useState<Category | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Category | null>(null);

  const rows = useMemo(() => (data ?? []).filter(c =>
    matchesStatus(c.active, status) &&
    (!search || c.name.includes(search) || (c.description ?? "").includes(search))), [data, search, status]);

  const toggle = async (c: Category) => {
    try {
      await setCategoryActive(c.id, !c.active);
      notify.success(c.active ? `تم إيقاف تصنيف ${c.name}` : `تم تفعيل تصنيف ${c.name}`);
      await reload();
    } catch (e) { notify.error(e); }
  };

  const columns: Column<Category>[] = [
    { key: "name", header: "التصنيف", sortValue: c => c.name, render: c => (
      <div>
        <p className="font-medium text-text">{c.name}</p>
        {c.description && <p className="text-[11px] text-subtext line-clamp-1">{c.description}</p>}
      </div>) },
    { key: "mode", header: "طريقة البيع", sortValue: c => c.sale_mode, render: c => (
      <Badge tone={c.sale_mode === "stock_item" ? "muted" : "accent"}>{saleModes.label(c.sale_mode)}</Badge>) },
    { key: "count", header: "عدد المنتجات", sortValue: c => c.product_count, render: c => <span className="tabular-nums">{fmtInt(c.product_count)}</span> },
    { key: "order", header: "الترتيب", sortValue: c => c.sort_order, render: c => <span className="tabular-nums text-subtext">{fmtInt(c.sort_order)}</span> },
    { key: "status", header: "الحالة", sortValue: c => (c.active ? 0 : 1), render: c => <ActiveBadge active={c.active} /> },
    ...(canManage ? [{ key: "actions", header: "", className: "w-44", render: (c: Category) => (
      <div className="flex items-center gap-3 justify-end whitespace-nowrap">
        <button onClick={() => { setEditing(c); setFormOpen(true); }} className="text-xs text-accent hover:underline inline-flex items-center gap-1">
          <Pencil className="w-3 h-3" />تعديل
        </button>
        <button onClick={() => toggle(c)} className={`text-xs hover:underline ${c.active ? "text-danger" : "text-success"}`}>
          {c.active ? "إيقاف" : "تفعيل"}
        </button>
        <button onClick={() => setToDelete(c)} className="text-xs text-danger hover:underline inline-flex items-center gap-1">
          <Trash2 className="w-3 h-3" />حذف
        </button>
      </div>) }] : []),
  ];

  return (
    <>
      <PageHeader title="التصنيفات" count={data ? `${fmtInt(data.length)} تصنيف` : undefined}
        actions={canManage && (
          <button onClick={() => { setEditing(null); setFormOpen(true); }} className="eg-btn-primary !py-1.5 !text-xs">
            <Plus className="w-3.5 h-3.5" />تصنيف جديد
          </button>)} />
      <PageBody>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="بحث باسم التصنيف" className="w-full sm:w-64" />
          <Segmented value={status} onChange={setStatus} options={statusOptions} />
        </div>
        <AsyncBoundary loading={loading && !data} error={error} onRetry={reload}>
          <DataTable rows={rows} columns={columns} rowKey={c => c.id} emptyMessage="لا توجد تصنيفات مطابقة"
            rowClassName={c => (c.active ? undefined : "opacity-60")} />
        </AsyncBoundary>
      </PageBody>
      {formOpen && (
        <CategoryForm category={editing} onClose={() => setFormOpen(false)}
          onSaved={async name => { setFormOpen(false); notify.success(`تم حفظ التصنيف ${name}`); await reload(); }} />
      )}
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} title="حذف التصنيف" confirmLabel="حذف"
        message={toDelete ? `حذف تصنيف "${toDelete.name}" نهائياً؟ لا يمكن الحذف إذا كان فيه منتجات، وفي هذه الحالة استخدم الإيقاف.` : ""}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteCategory(toDelete.id);
          notify.success(`تم حذف ${toDelete.name}`);
          setToDelete(null);
          await reload();
        }} />
    </>
  );
}

function CategoryForm({
  category, onClose, onSaved,
}: { category: Category | null; onClose: () => void; onSaved: (name: string) => void }) {
  const modes = useSaleModes().modes;
  const [form, setForm] = useState<CategoryInput>(() => category
    ? { name: category.name, description: category.description ?? "", sort_order: category.sort_order, active: category.active, sale_mode: category.sale_mode }
    : empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // the sale mode can't change once products exist (the database enforces it too)
  const locked = !!category && category.product_count > 0;

  const save = async () => {
    if (!form.name.trim()) { setError("اسم التصنيف مطلوب"); return; }
    setSaving(true); setError("");
    try {
      await saveCategory({ ...form, name: form.name.trim(), description: form.description?.trim() || null }, category?.id);
      onSaved(form.name.trim());
    } catch (e) { setError(errorMessage(e)); }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={category ? `تعديل ${category.name}` : "تصنيف جديد"}>
      <div className="space-y-4">
        <Field label="اسم التصنيف" required>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="eg-input" placeholder="مثال: تركيبات" autoFocus />
        </Field>
        <Field label="طريقة البيع" required
          hint={locked ? "لا يمكن تغييرها لأن التصنيف يحتوي على منتجات" : "تُطبق على كل منتجات التصنيف تلقائياً، ولا تُختار لكل منتج"}>
          <select value={form.sale_mode} onChange={e => setForm(f => ({ ...f, sale_mode: e.target.value }))} className="eg-select" disabled={locked}>
            {modes.map(m => <option key={m.mode} value={m.mode}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="الوصف">
          <textarea value={form.description ?? ""} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="eg-input" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الترتيب" hint="الأصغر يظهر أولاً">
            <input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: Number(e.target.value) || 0 }))} className="eg-input" />
          </Field>
          <Field label="الحالة">
            <select value={form.active ? "1" : "0"} onChange={e => setForm(f => ({ ...f, active: e.target.value === "1" }))} className="eg-select">
              <option value="1">مفعّل</option>
              <option value="0">متوقف</option>
            </select>
          </Field>
        </div>
        <FormError message={error} />
        <button onClick={save} disabled={saving} className="eg-btn-primary w-full justify-center">
          {saving ? "جاري الحفظ..." : "حفظ التصنيف"}
        </button>
      </div>
    </Modal>
  );
}
