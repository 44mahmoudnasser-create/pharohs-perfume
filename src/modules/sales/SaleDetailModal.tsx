import { useState } from "react";
import { Ban } from "lucide-react";
import Modal from "@/core/ui/Modal";
import ConfirmDialog from "@/core/ui/ConfirmDialog";
import { AsyncBoundary } from "@/core/ui/States";
import { Badge } from "@/core/ui/Badges";
import { useAsync } from "@/core/hooks/useAsync";
import { useAuth } from "@/core/auth/AuthProvider";
import { useNotify } from "@/core/ui/Notifications";
import { useShop } from "@/core/settings/SettingsProvider";
import { fmtDateTime, fmtMoney, fmtNum, fmtQty } from "@/core/lib/format";
import { cancelSale, getSale } from "./api";

export default function SaleDetailModal({
  saleId, names, onClose, onChanged,
}: { saleId: number; names: Record<string, string>; onClose: () => void; onChanged: () => void }) {
  const sale = useAsync(() => getSale(saleId), [saleId]);
  const { can } = useAuth();
  const notify = useNotify();
  const { currency } = useShop();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const s = sale.data;

  return (
    <Modal open onClose={onClose} title={`فاتورة #${saleId}`} size="lg">
      <AsyncBoundary loading={sale.loading && !s} error={sale.error} onRetry={sale.reload}>
        {s && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <Info label="التاريخ" value={fmtDateTime(s.created_at)} />
              <Info label="البائع" value={(s.created_by && names[s.created_by]) || "—"} />
              <Info label="العميل" value={s.customer_name ?? "—"} />
              <Info label="الحالة" value={<Badge tone={s.status === "completed" ? "success" : "danger"}>{s.status === "completed" ? "مكتملة" : "ملغاة"}</Badge>} />
            </div>
            {s.notes && <p className="text-xs text-subtext bg-card2 rounded-lg p-3">ملاحظات: {s.notes}</p>}
            {s.status === "cancelled" && (
              <p className="text-xs text-danger bg-danger/10 rounded-lg p-3">
                أُلغيت في {fmtDateTime(s.cancelled_at)}{s.cancelled_by && names[s.cancelled_by] ? ` بواسطة ${names[s.cancelled_by]}` : ""} — السبب: {s.cancel_reason}.
                تمت إعادة المخزون بحركات عكسية.
              </p>
            )}

            <div className="space-y-2">
              {s.lines.map(l => (
                <div key={l.id} className="bg-card2/60 rounded-xl p-3 border border-border/40">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-text">{l.product_name}</p>
                      {l.perfume && (
                        <p className="text-[11px] text-subtext">{l.perfume.bottle_size_name} · زيت {l.perfume.oil_type_name} · {fmtNum(l.perfume.grams_per_bottle)} جم/زجاجة</p>
                      )}
                      <p className="text-[11px] text-subtext tabular-nums">
                        {fmtNum(l.quantity)} × {fmtMoney(l.unit_price, currency)}
                        {Number(l.unit_price) !== Number(l.list_unit_price) && <span className="text-warning"> (سعر القائمة {fmtMoney(l.list_unit_price, currency)})</span>}
                      </p>
                    </div>
                    <span className="text-sm font-bold tabular-nums">{fmtMoney(l.line_total, currency)}</span>
                  </div>
                  <div className="mt-2 pt-2 border-t border-border/40 flex flex-wrap gap-x-4 gap-y-1">
                    {l.components.map(c => (
                      <span key={c.id} className="text-[11px] text-subtext">
                        خصم: <span className="text-text">{c.item_name}</span> {fmtQty(c.quantity_total, c.unit)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-border/50 pt-3">
              <span className="text-sm text-subtext">الإجمالي</span>
              <span className="text-xl font-extrabold tabular-nums">{fmtMoney(s.total, currency)}</span>
            </div>

            {s.status === "completed" && can("sales.cancel") && (
              <button onClick={() => setConfirmOpen(true)} className="eg-btn-ghost text-danger w-full justify-center">
                <Ban className="w-4 h-4" />إلغاء الفاتورة وإرجاع المخزون
              </button>
            )}
          </div>
        )}
      </AsyncBoundary>

      <ConfirmDialog open={confirmOpen} onClose={() => setConfirmOpen(false)}
        title={`إلغاء الفاتورة #${saleId}`} confirmLabel="تأكيد الإلغاء" reasonLabel="سبب الإلغاء"
        message="سيتم تسجيل حركات عكسية تعيد الزيت والزجاجات للمخزون بنفس الكميات المخصومة. لا يمكن التراجع عن الإلغاء."
        onConfirm={async reason => {
          await cancelSale(saleId, reason);
          notify.success(`تم إلغاء الفاتورة #${saleId}`);
          await sale.reload();
          onChanged();
        }} />
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-card2 rounded-lg px-3 py-2">
      <p className="text-[10px] text-subtext">{label}</p>
      <div className="text-text mt-0.5">{value}</div>
    </div>
  );
}
