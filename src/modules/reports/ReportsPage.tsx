import { useState } from "react";
import { Download } from "lucide-react";
import PageHeader, { PageBody } from "@/core/ui/PageHeader";
import { AsyncBoundary, EmptyState } from "@/core/ui/States";
import { FilterSelect } from "@/core/ui/Form";
import { useAsync } from "@/core/hooks/useAsync";
import { useShop } from "@/core/settings/SettingsProvider";
import { supabase } from "@/core/lib/supabase";
import { unwrap } from "@/core/lib/errors";
import { downloadCsv } from "@/core/lib/csv";
import { daysAgo, fmtDate, fmtInt, fmtMoney, fmtNum, fmtQty, isoDate } from "@/core/lib/format";
import { GROUP_LABEL, listStock, type ItemGroup } from "@/modules/inventory/api";

type ReportKey =
  | "sales_day" | "sales_product" | "sales_category" | "sales_bottle_size" | "sales_oil_type"
  | "oil_consumption" | "bottle_consumption" | "oil_stock" | "bottle_stock";

const REPORTS: { value: ReportKey; label: string; group: string }[] = [
  { value: "sales_day", label: "المبيعات حسب اليوم", group: "المبيعات" },
  { value: "sales_product", label: "المبيعات حسب العطر / المنتج", group: "المبيعات" },
  { value: "sales_category", label: "المبيعات حسب التصنيف", group: "المبيعات" },
  { value: "sales_bottle_size", label: "المبيعات حسب حجم الزجاجة", group: "المبيعات" },
  { value: "sales_oil_type", label: "المبيعات حسب نوع الزيت", group: "المبيعات" },
  { value: "oil_consumption", label: "استهلاك الزيوت في الفترة", group: "الاستهلاك" },
  { value: "bottle_consumption", label: "استهلاك الزجاجات حسب الحجم", group: "الاستهلاك" },
  { value: "oil_stock", label: "رصيد الزيوت الحالي", group: "المخزون" },
  { value: "bottle_stock", label: "رصيد الزجاجات الحالي", group: "المخزون" },
];

type SalesRow = { key: string; label: string; sales_count: number; quantity: number; revenue: number; oil_grams: number };
type ConsRow = { item_id: number; item_name: string; unit: string; consumed: number; reversed: number; net_consumed: number };
type Table = { headers: string[]; rows: (string | number)[][]; display: React.ReactNode[][]; footer?: React.ReactNode[] };

export default function ReportsPage() {
  const { currency } = useShop();
  const [report, setReport] = useState<ReportKey>("sales_day");
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(isoDate());
  const isStock = report === "oil_stock" || report === "bottle_stock";

  const data = useAsync<Table>(async () => {
    if (report.startsWith("sales_")) {
      const dim = report.replace("sales_", "");
      const rows = unwrap(await supabase.rpc("report_sales_by", { p_from: from, p_to: to, p_dimension: dim })) as SalesRow[];
      const perfumeDim = dim === "bottle_size" || dim === "oil_type";
      const headers = [dim === "day" ? "اليوم" : "البند", "عدد الفواتير", perfumeDim ? "عدد الزجاجات" : "الكمية", "المبيعات", ...(perfumeDim || dim === "day" || dim === "product" ? ["زيت مستهلك (جم)"] : [])];
      const withOil = headers.length === 5;
      const sum = (k: keyof SalesRow) => rows.reduce((a, r) => a + Number(r[k]), 0);
      return {
        headers,
        rows: rows.map(r => [r.label, r.sales_count, Number(r.quantity), Number(r.revenue), ...(withOil ? [Number(r.oil_grams)] : [])]),
        display: rows.map(r => [dim === "day" ? fmtDate(r.label) : r.label, fmtInt(r.sales_count), fmtNum(r.quantity), fmtMoney(r.revenue, currency),
          ...(withOil ? [fmtNum(r.oil_grams)] : [])]),
        footer: ["الإجمالي", "", fmtNum(sum("quantity")), fmtMoney(sum("revenue"), currency), ...(withOil ? [fmtNum(sum("oil_grams"))] : [])],
      };
    }
    if (report === "oil_consumption" || report === "bottle_consumption") {
      const group = report === "oil_consumption" ? "raw_material" : "packaging";
      const rows = unwrap(await supabase.rpc("report_stock_consumption", { p_from: from, p_to: to, p_item_group: group })) as ConsRow[];
      return {
        headers: ["الصنف", "المستهلك في البيع", "المرتجع بالإلغاء", "صافي الاستهلاك", "الوحدة"],
        rows: rows.map(r => [r.item_name, Number(r.consumed), Number(r.reversed), Number(r.net_consumed), r.unit]),
        display: rows.map(r => [r.item_name, fmtQty(r.consumed, r.unit), fmtQty(r.reversed, r.unit), fmtQty(r.net_consumed, r.unit), ""]).map(r => r.slice(0, 4)),
      };
    }
    const group: ItemGroup = report === "oil_stock" ? "raw_material" : "packaging";
    const rows = (await listStock()).filter(r => r.item_group === group && r.active);
    return {
      headers: ["الصنف", "الرصيد الدفتري", "حد الطلب", "الحالة", "الوحدة"],
      rows: rows.map(r => [r.name, Number(r.quantity), Number(r.reorder_level), r.is_low ? "منخفض" : "جيد", r.unit]),
      display: rows.map(r => [r.name, fmtQty(r.quantity, r.unit), fmtQty(r.reorder_level, r.unit), r.is_low ? "⚠ منخفض" : "جيد"]),
    };
  }, [report, from, to, currency]);

  const label = REPORTS.find(r => r.value === report)!.label;
  const shownHeaders = data.data ? data.data.headers.slice(0, data.data.display[0]?.length ?? data.data.headers.length) : [];

  return (
    <>
      <PageHeader title="التقارير" subtitle="كل الأرقام محسوبة من الفواتير المسجلة وسجل حركات المخزون"
        actions={data.data && data.data.rows.length > 0 && (
          <button onClick={() => downloadCsv(`${label} ${isStock ? isoDate() : `${from}_${to}`}.csv`, data.data!.headers, data.data!.rows)}
            className="eg-btn-ghost !py-1.5 !text-xs"><Download className="w-3.5 h-3.5" />تصدير CSV</button>)} />
      <PageBody>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="eg-label">التقرير</label>
            <FilterSelect value={report} onChange={setReport} options={REPORTS.map(r => ({ value: r.value, label: `${r.group}: ${r.label}` }))} />
          </div>
          {!isStock && (
            <>
              <div><label className="eg-label">من</label><input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="eg-input !py-1.5 !text-xs" /></div>
              <div><label className="eg-label">إلى</label><input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="eg-input !py-1.5 !text-xs" /></div>
            </>
          )}
        </div>
        {isStock && (
          <p className="text-[11px] text-warning">الرصيد الدفتري محسوب من الحركات وليس جرداً فعلياً — {GROUP_LABEL[report === "oil_stock" ? "raw_material" : "packaging"]}</p>
        )}
        {report.startsWith("sales_") && <p className="text-[11px] text-subtext">الفواتير المكتملة فقط (الملغاة مستبعدة)، حسب تاريخ الفاتورة بتوقيت المتجر.</p>}
        {(report === "oil_consumption" || report === "bottle_consumption") && (
          <p className="text-[11px] text-subtext">من سجل الحركات: خصم البيع ناقص الحركات العكسية للفواتير الملغاة، حسب تاريخ الحركة.</p>
        )}

        <AsyncBoundary loading={data.loading && !data.data} error={data.error} onRetry={data.reload}>
          {data.data && data.data.display.length === 0 ? <div className="eg-card"><EmptyState message="لا توجد بيانات في هذه الفترة" /></div> : data.data && (
            <div className="eg-card !p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="eg-table">
                  <thead><tr>{shownHeaders.map(h => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.data.display.map((r, i) => (
                      <tr key={i}>{r.map((c, j) => <td key={j} className={j > 0 ? "tabular-nums" : "font-medium text-text"}>{c}</td>)}</tr>
                    ))}
                  </tbody>
                  {data.data.footer && (
                    <tfoot><tr className="bg-card2 font-bold">{data.data.footer.map((c, j) => <td key={j} className="tabular-nums">{c}</td>)}</tr></tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </AsyncBoundary>
      </PageBody>
    </>
  );
}
