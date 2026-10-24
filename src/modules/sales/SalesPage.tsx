import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import PageHeader, { PageBody } from "@/core/ui/PageHeader";
import DataTable, { type Column } from "@/core/ui/DataTable";
import { AsyncBoundary } from "@/core/ui/States";
import { Badge } from "@/core/ui/Badges";
import KpiCard from "@/core/ui/KpiCard";
import { SearchInput, Segmented } from "@/core/ui/Form";
import { useAsync } from "@/core/hooks/useAsync";
import { useAuth } from "@/core/auth/AuthProvider";
import { useShop } from "@/core/settings/SettingsProvider";
import { daysAgo, fmtDateTime, fmtInt, fmtMoney, isoDate } from "@/core/lib/format";
import { getUserNames, listSales, type SaleSummary } from "./api";
import SaleDetailModal from "./SaleDetailModal";

type Status = "all" | "completed" | "cancelled";

// Totals are summed from the lines this user can see, so a seller never sees
// the value of lines outside their granted categories.
const visibleTotal = (s: SaleSummary) => s.sale_lines.reduce((a, l) => a + Number(l.line_total), 0);

export default function SalesPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const { currency } = useShop();
  const [from, setFrom] = useState(() => (can("sales.viewAll") ? daysAgo(6) : isoDate()));
  const [to, setTo] = useState(isoDate());
  const [status, setStatus] = useState<Status>("all");
  const [search, setSearch] = useState("");
  const openId = Number(params.get("open")) || null;

  const sales = useAsync(() => listSales(from, to, status), [from, to, status]);
  const names = useAsync(getUserNames, []);

  const rows = useMemo(() => (sales.data ?? []).filter(s => {
    if (!search) return true;
    const q = search.trim();
    return String(s.id) === q.replace("#", "") || (s.customer_name ?? "").includes(q) ||
      s.sale_lines.some(l => l.product_name.includes(q));
  }), [sales.data, search]);

  const completed = (sales.data ?? []).filter(s => s.status === "completed");
  const revenue = completed.reduce((a, s) => a + visibleTotal(s), 0);

  const open = (id: number | null) => setParams(p => { if (id) p.set("open", String(id)); else p.delete("open"); return p; });

  const columns: Column<SaleSummary>[] = [
    { key: "id", header: "رقم", sortValue: s => s.id, render: s => <span className="font-mono text-accent">#{s.id}</span> },
    { key: "date", header: "التاريخ", sortValue: s => s.created_at, render: s => <span className="text-xs whitespace-nowrap">{fmtDateTime(s.created_at)}</span> },
    { key: "items", header: "الأصناف", render: s => (
      <span className="text-xs text-subtext line-clamp-1 max-w-[16rem]">
        {s.sale_lines.map(l => `${l.product_name} ×${fmtInt(l.quantity)}`).join("، ")}
      </span>) },
    { key: "customer", header: "العميل", render: s => s.customer_name ?? <span className="text-subtext">—</span> },
    { key: "seller", header: "البائع", render: s => <span className="text-xs">{(s.created_by && names.data?.[s.created_by]) || "—"}</span> },
    { key: "total", header: "الإجمالي", sortValue: s => visibleTotal(s), render: s => (
      <span className={`tabular-nums font-semibold ${s.status === "cancelled" ? "line-through text-subtext" : ""}`}>{fmtMoney(visibleTotal(s), currency)}</span>) },
    { key: "status", header: "الحالة", sortValue: s => s.status, render: s =>
      <Badge tone={s.status === "completed" ? "success" : "danger"}>{s.status === "completed" ? "مكتملة" : "ملغاة"}</Badge> },
  ];

  return (
    <>
      <PageHeader title="المبيعات" subtitle={can("sales.viewAll") ? "كل الفواتير" : "فواتيرك فقط"}
        actions={can("sales.create") && (
          <Link to="/sales/new" className="eg-btn-primary !py-1.5 !text-xs"><Plus className="w-3.5 h-3.5" />بيع جديد</Link>)} />
      <PageBody>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="eg-label">من</label>
            <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="eg-input !py-1.5 !text-xs" />
          </div>
          <div>
            <label className="eg-label">إلى</label>
            <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="eg-input !py-1.5 !text-xs" />
          </div>
          <Segmented value={status} onChange={setStatus} options={[
            { value: "all", label: "الكل" }, { value: "completed", label: "مكتملة" }, { value: "cancelled", label: "ملغاة" },
          ]} />
          <SearchInput value={search} onChange={setSearch} placeholder="رقم الفاتورة أو العميل أو المنتج" className="w-full sm:w-64" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KpiCard label="فواتير مكتملة" value={fmtInt(completed.length)} />
          <KpiCard label="إجمالي المبيعات" value={fmtMoney(revenue)} color="text-success" />
          <KpiCard label="فواتير ملغاة" value={fmtInt((sales.data ?? []).length - completed.length)} color="text-danger" />
        </div>

        <AsyncBoundary loading={sales.loading && !sales.data} error={sales.error} onRetry={sales.reload}>
          <DataTable rows={rows} columns={columns} rowKey={s => s.id} onRowClick={s => open(s.id)}
            initialSort={{ key: "date", dir: "desc" }} emptyMessage="لا توجد فواتير في هذه الفترة"
            rowClassName={s => (s.status === "cancelled" ? "opacity-60" : undefined)} />
        </AsyncBoundary>
      </PageBody>

      {openId && (
        <SaleDetailModal saleId={openId} names={names.data ?? {}} onClose={() => open(null)}
          onChanged={() => void sales.reload()} />
      )}
    </>
  );
}
