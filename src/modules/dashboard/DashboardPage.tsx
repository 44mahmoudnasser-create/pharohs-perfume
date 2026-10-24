import { useNavigate, Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Plus } from "lucide-react";
import PageHeader, { PageBody } from "@/core/ui/PageHeader";
import KpiCard from "@/core/ui/KpiCard";
import { AsyncBoundary } from "@/core/ui/States";
import { Badge } from "@/core/ui/Badges";
import { useAsync } from "@/core/hooks/useAsync";
import { useAuth } from "@/core/auth/AuthProvider";
import { useShop } from "@/core/settings/SettingsProvider";
import { supabase } from "@/core/lib/supabase";
import { unwrap } from "@/core/lib/errors";
import { cn } from "@/core/lib/cn";
import { fmtDate, fmtDateTime, fmtInt, fmtMoney, fmtQty } from "@/core/lib/format";
import { listStock } from "@/modules/inventory/api";

type Summary = {
  today: string; sales_today: number; revenue_today: number; bottles_today: number;
  low_stock_items: number; missing_rules: number; missing_prices: number;
};
// sale_lines are already filtered to what this user may see
type Recent = { id: number; status: string; created_at: string; customer_name: string | null; sale_lines: { line_total: number }[] };

export default function DashboardPage() {
  const navigate = useNavigate();
  const { can, profile } = useAuth();
  const { currency, name } = useShop();
  const data = useAsync(async () => {
    const [summary, recent, stock] = await Promise.all([
      supabase.rpc("dashboard_summary").then(unwrap) as Promise<Summary>,
      supabase.from("sales").select("id, status, created_at, customer_name, sale_lines(line_total)")
        .order("created_at", { ascending: false }).limit(8).then(unwrap) as Promise<Recent[]>,
      can("inventory.view") ? listStock() : Promise.resolve([]),
    ]);
    return { summary, recent, low: stock.filter(s => s.active && s.is_low) };
  }, []);
  const s = data.data?.summary;
  const canStock = can("inventory.view");

  const alerts: { text: string; tone: "danger" | "warning"; to?: string }[] = [];
  if (s) {
    if (s.missing_rules > 0) alerts.push({ text: `${fmtInt(s.missing_rules)} تركيبة (زيت × حجم) بدون قاعدة استهلاك — لا يمكن بيعها`, tone: "danger", to: "/perfume/rules" });
    if (s.missing_prices > 0) alerts.push({ text: `${fmtInt(s.missing_prices)} تركيبة بدون سعر افتراضي`, tone: "warning", to: "/perfume/rules" });
    if (s.low_stock_items > 0) alerts.push({ text: `${fmtInt(s.low_stock_items)} صنف مخزون وصل لحد الطلب أو أقل`, tone: "warning", to: "/inventory" });
  }

  return (
    <>
      <PageHeader title={name} subtitle={s ? `${fmtDate(s.today)} — أهلاً ${profile?.full_name ?? ""}` : undefined}
        actions={can("sales.create") && <Link to="/sales/new" className="eg-btn-primary !py-1.5 !text-xs"><Plus className="w-3.5 h-3.5" />بيع جديد</Link>} />
      <PageBody className="!space-y-5">
        <AsyncBoundary loading={data.loading && !data.data} error={data.error} onRetry={data.reload}>
          {s && data.data && (
            <>
              <section className={cn("grid gap-3", canStock ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-3")}>
                <KpiCard label={can("sales.viewAll") ? "فواتير اليوم" : "فواتيرك اليوم"} value={fmtInt(s.sales_today)} onClick={() => navigate("/sales")} hint="عرض" />
                <KpiCard label="مبيعات اليوم" value={fmtMoney(s.revenue_today)} color="text-success" />
                <KpiCard label="زجاجات عطر اليوم" value={fmtInt(s.bottles_today)} color="text-accent2" />
                {canStock && (
                  <KpiCard label="أصناف منخفضة" value={fmtInt(s.low_stock_items)} color={s.low_stock_items ? "text-warning" : "text-success"}
                    onClick={() => navigate("/inventory")} hint="المخزون" />
                )}
              </section>

              {can("perfume.view") && (
                <section className="space-y-2">
                  <h2 className="text-xs font-semibold text-subtext">تنبيهات تحتاج متابعة</h2>
                  {alerts.length === 0 ? (
                    <div className="eg-card !p-3 flex items-center gap-2 text-sm text-success"><CheckCircle2 className="w-4 h-4" />لا توجد تنبيهات</div>
                  ) : alerts.map(a => {
                    const body = (
                      <div className={cn("eg-card !p-3 flex items-center gap-2 text-sm", a.tone === "danger" ? "!border-danger/40 text-danger" : "!border-warning/40 text-warning",
                        a.to && "hover:bg-card2 transition-colors")}>
                        <AlertTriangle className="w-4 h-4 shrink-0" />{a.text}
                      </div>);
                    return a.to ? <Link key={a.text} to={a.to} className="block">{body}</Link> : <div key={a.text}>{body}</div>;
                  })}
                </section>
              )}

              <div className={cn("grid grid-cols-1 gap-4", canStock && "lg:grid-cols-2")}>
                <section className="eg-card !p-0 overflow-hidden">
                  <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                    <h2 className="text-sm font-bold">آخر الفواتير</h2>
                    <Link to="/sales" className="text-xs text-accent hover:underline">الكل</Link>
                  </div>
                  {data.data.recent.length === 0 ? <p className="text-sm text-subtext text-center py-8">لا توجد فواتير بعد</p> : (
                    <ul className="divide-y divide-border/40">
                      {data.data.recent.map(r => {
                        const total = r.sale_lines.reduce((a, l) => a + Number(l.line_total), 0);
                        return (
                          <li key={r.id}>
                            <Link to={`/sales?open=${r.id}`} className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-card2/50">
                              <div className="min-w-0">
                                <p className="text-sm"><span className="font-mono text-accent">#{r.id}</span> {r.customer_name && <span className="text-subtext">· {r.customer_name}</span>}</p>
                                <p className="text-[11px] text-subtext">{fmtDateTime(r.created_at)}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                {r.status === "cancelled" && <Badge tone="danger">ملغاة</Badge>}
                                <span className={cn("text-sm font-bold tabular-nums", r.status === "cancelled" && "line-through text-subtext")}>{fmtMoney(total, currency)}</span>
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                {canStock && (
                  <section className="eg-card !p-0 overflow-hidden">
                    <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                      <h2 className="text-sm font-bold">أصناف تحتاج إعادة طلب</h2>
                      <Link to="/inventory" className="text-xs text-accent hover:underline">المخزون</Link>
                    </div>
                    {data.data.low.length === 0 ? <p className="text-sm text-subtext text-center py-8">كل الأرصدة أعلى من حد الطلب</p> : (
                      <ul className="divide-y divide-border/40">
                        {data.data.low.slice(0, 10).map(i => (
                          <li key={i.item_id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                            <span>{i.name}</span>
                            <span className={cn("tabular-nums font-semibold", Number(i.quantity) <= 0 ? "text-danger" : "text-warning")}>{fmtQty(i.quantity, i.unit)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
              </div>
            </>
          )}
        </AsyncBoundary>
      </PageBody>
    </>
  );
}
