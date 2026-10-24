import { useMemo, useState } from "react";
import { ImageOff, Pencil, Plus, Trash2 } from "lucide-react";
import PageHeader, { PageBody } from "@/core/ui/PageHeader";
import DataTable, { type Column } from "@/core/ui/DataTable";
import { AsyncBoundary } from "@/core/ui/States";
import { ActiveBadge, Badge } from "@/core/ui/Badges";
import ConfirmDialog from "@/core/ui/ConfirmDialog";
import { FilterSelect, SearchInput, Segmented, matchesStatus, statusOptions, type StatusFilter } from "@/core/ui/Form";
import { useAsync } from "@/core/hooks/useAsync";
import { useNotify } from "@/core/ui/Notifications";
import { useAuth } from "@/core/auth/AuthProvider";
import { useShop } from "@/core/settings/SettingsProvider";
import { fmtInt, fmtMoney } from "@/core/lib/format";
import { useSaleModes } from "@/modules/sales/saleModes";
import { deleteProduct, listCategories, listProducts, setProductActive, type Product } from "./api";
import ProductFormModal from "./ProductFormModal";

export default function ProductsPage() {
  const products = useAsync(listProducts, []);
  const categories = useAsync(listCategories, []);
  const { can } = useAuth();
  const notify = useNotify();
  const { currency } = useShop();
  const saleModes = useSaleModes();
  const canManage = can("catalog.manage");

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [mode, setMode] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [editing, setEditing] = useState<Product | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Product | null>(null);

  const rows = useMemo(() => (products.data ?? []).filter(p =>
    matchesStatus(p.active, status) &&
    (categoryId === "all" || String(p.category_id) === categoryId) &&
    (mode === "all" || p.sale_mode === mode) &&
    (!search || p.name.includes(search) || (p.sku ?? "").toLowerCase().includes(search.toLowerCase()))),
  [products.data, search, categoryId, mode, status]);

  const toggle = async (p: Product) => {
    try {
      await setProductActive(p.id, !p.active);
      notify.success(p.active ? `تم إيقاف ${p.name}` : `تم تفعيل ${p.name}`);
      await products.reload();
    } catch (e) { notify.error(e); }
  };

  const columns: Column<Product>[] = [
    { key: "name", header: "المنتج", sortValue: p => p.name, render: p => (
      <div className="flex items-center gap-3 min-w-[12rem]">
        {p.image_url
          ? <img src={p.image_url} alt="" className="w-9 h-9 rounded-lg object-cover bg-card2 shrink-0" loading="lazy" />
          : <div className="w-9 h-9 rounded-lg bg-card2 flex items-center justify-center shrink-0"><ImageOff className="w-4 h-4 text-subtext/50" /></div>}
        <div className="min-w-0">
          <p className="font-medium text-text truncate">{p.name}</p>
          {p.sku && <p className="text-[11px] text-subtext font-mono" dir="ltr">{p.sku}</p>}
        </div>
      </div>) },
    { key: "category", header: "التصنيف", sortValue: p => p.category?.name ?? "", render: p => p.category?.name ?? "—" },
    { key: "mode", header: "طريقة البيع", sortValue: p => p.sale_mode, render: p => (
      <Badge tone={p.sale_mode === "stock_item" ? "muted" : "accent"}>{saleModes.label(p.sale_mode)}</Badge>) },
    { key: "price", header: "السعر", sortValue: p => p.unit_price ?? -1, render: p => p.unit_price != null
        ? <span className="tabular-nums">{fmtMoney(p.unit_price, currency)}</span>
        : <span className="text-[11px] text-subtext">حسب الاختيار وقت البيع</span> },
    { key: "status", header: "الحالة", sortValue: p => (p.active ? 0 : 1), render: p => <ActiveBadge active={p.active} /> },
    ...(canManage ? [{ key: "actions", header: "", className: "w-44", render: (p: Product) => (
      <div className="flex items-center gap-3 justify-end">
        <button onClick={() => { setEditing(p); setFormOpen(true); }} className="text-xs text-accent hover:underline inline-flex items-center gap-1">
          <Pencil className="w-3 h-3" />تعديل
        </button>
        <button onClick={() => toggle(p)} className={`text-xs hover:underline ${p.active ? "text-danger" : "text-success"}`}>
          {p.active ? "إيقاف" : "تفعيل"}
        </button>
        <button onClick={() => setToDelete(p)} className="text-xs text-danger hover:underline inline-flex items-center gap-1">
          <Trash2 className="w-3 h-3" />حذف
        </button>
      </div>) }] : []),
  ];

  return (
    <>
      <PageHeader title="المنتجات" count={products.data ? `${fmtInt(products.data.length)} منتج` : undefined}
        actions={canManage && (
          <button onClick={() => { setEditing(null); setFormOpen(true); }} className="eg-btn-primary !py-1.5 !text-xs"
            disabled={!categories.data?.length}>
            <Plus className="w-3.5 h-3.5" />منتج جديد
          </button>)} />
      <PageBody>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="بحث بالاسم أو الكود" className="w-full sm:w-64" />
          <FilterSelect value={categoryId} onChange={setCategoryId}
            options={[{ value: "all", label: "كل التصنيفات" }, ...(categories.data ?? []).map(c => ({ value: String(c.id), label: c.name }))]} />
          <FilterSelect value={mode} onChange={setMode}
            options={[{ value: "all", label: "كل طرق البيع" }, ...saleModes.modes.map(m => ({ value: m.mode, label: m.label }))]} />
          <Segmented value={status} onChange={setStatus} options={statusOptions} />
        </div>
        <AsyncBoundary loading={products.loading && !products.data} error={products.error} onRetry={products.reload}>
          <DataTable rows={rows} columns={columns} rowKey={p => p.id} emptyMessage="لا توجد منتجات مطابقة"
            rowClassName={p => (p.active ? undefined : "opacity-60")} />
        </AsyncBoundary>
      </PageBody>
      {formOpen && categories.data && (
        <ProductFormModal product={editing} categories={categories.data}
          onClose={() => setFormOpen(false)}
          onSaved={async () => { await products.reload(); }} />
      )}
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} title="حذف المنتج" confirmLabel="حذف"
        message={toDelete ? `حذف "${toDelete.name}" نهائياً؟ لا يمكن الحذف إذا سُجل عليه بيع، وفي هذه الحالة استخدم الإيقاف.` : ""}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteProduct(toDelete.id);
          notify.success(`تم حذف ${toDelete.name}`);
          setToDelete(null);
          await products.reload();
        }} />
    </>
  );
}
