import { Fragment, useState } from "react";
import { Save } from "lucide-react";
import PageHeader, { PageBody } from "@/core/ui/PageHeader";
import { AsyncBoundary, EmptyState } from "@/core/ui/States";
import { ActiveBadge, Badge } from "@/core/ui/Badges";
import { Field, FormError, Segmented } from "@/core/ui/Form";
import Modal from "@/core/ui/Modal";
import { useAsync } from "@/core/hooks/useAsync";
import { useAuth } from "@/core/auth/AuthProvider";
import { useNotify } from "@/core/ui/Notifications";
import { useSettings } from "@/core/settings/SettingsProvider";
import { supabase } from "@/core/lib/supabase";
import { errorMessage, unwrap } from "@/core/lib/errors";
import { fmtDateTime } from "@/core/lib/format";
import { ROLE_LABEL, roleLabel } from "@/app/permissions";
import { listCategories } from "@/modules/catalog/api";
import { cn } from "@/core/lib/cn";

type Tab = "general" | "users" | "audit";

export default function SettingsPage() {
  const { can } = useAuth();
  const { rows } = useSettings();
  const [tab, setTab] = useState<Tab>("general");
  return (
    <>
      <PageHeader title="الإعدادات" />
      <PageBody>
        <Segmented value={tab} onChange={setTab} options={[
          { value: "general", label: "إعدادات المتجر" },
          { value: "users", label: "المستخدمون والصلاحيات" },
          ...(can("audit.view") ? [{ value: "audit" as const, label: "سجل التعديلات" }] : []),
        ]} />
        {tab === "general" && <GeneralSettings key={rows.map(r => r.updated_at).join()} />}
        {tab === "users" && <UsersSettings />}
        {tab === "audit" && <AuditLog />}
      </PageBody>
    </>
  );
}

function GeneralSettings() {
  const { get, reload } = useSettings();
  const notify = useNotify();
  const [form, setForm] = useState(() => ({
    name: get("shop.name", ""), currency: get("shop.currency", ""), timezone: get("shop.timezone", "Africa/Cairo"),
    negative: get("inventory.allow_negative_stock", false), override: get("sales.allow_price_override", false),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!form.name.trim()) { setError("اسم المتجر مطلوب"); return; }
    try { new Intl.DateTimeFormat("en", { timeZone: form.timezone }); } catch { setError("المنطقة الزمنية غير صحيحة (مثال: Africa/Cairo)"); return; }
    setBusy(true); setError("");
    try {
      const updates: [string, unknown][] = [
        ["shop.name", form.name.trim()], ["shop.currency", form.currency.trim()], ["shop.timezone", form.timezone.trim()],
        ["inventory.allow_negative_stock", form.negative], ["sales.allow_price_override", form.override],
      ];
      for (const [key, value] of updates) {
        unwrap(await supabase.from("app_settings").update({ value }).eq("key", key).select("key").single());
      }
      await reload();
      notify.success("تم حفظ الإعدادات");
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };

  return (
    <div className="eg-card max-w-2xl space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="اسم المتجر" required className="sm:col-span-2">
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="eg-input" />
        </Field>
        <Field label="رمز العملة">
          <input value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} className="eg-input" />
        </Field>
        <Field label="المنطقة الزمنية للتقارير" hint="تُستخدم لتحديد يوم الفاتورة" className="sm:col-span-3">
          <input value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))} className="eg-input" dir="ltr" />
        </Field>
      </div>
      <Toggle checked={form.negative} onChange={v => setForm(f => ({ ...f, negative: v }))}
        title="السماح بالبيع مع رصيد غير كافٍ"
        hint="عند التفعيل يمكن أن يصبح الرصيد بالسالب. يُفضل إبقاؤه متوقفاً وتسجيل الاستلام أولاً." danger />
      <Toggle checked={form.override} onChange={v => setForm(f => ({ ...f, override: v }))}
        title="السماح للبائع بتعديل سعر البيع"
        hint="المدير ومدير النظام يمكنهما تعديل السعر دائماً. السعر الأصلي يُحفظ في الفاتورة للمراجعة." />
      <FormError message={error} />
      <button onClick={save} disabled={busy} className="eg-btn-primary"><Save className="w-4 h-4" />{busy ? "جاري الحفظ..." : "حفظ الإعدادات"}</button>
    </div>
  );
}

function Toggle({ checked, onChange, title, hint, danger }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint: string; danger?: boolean }) {
  return (
    <label className="flex items-start gap-3 bg-card2 rounded-lg p-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-1 accent-[#3b82f6] w-4 h-4" />
      <span>
        <span className={`block text-sm font-semibold ${checked && danger ? "text-warning" : "text-text"}`}>{title}</span>
        <span className="block text-[11px] text-subtext mt-0.5">{hint}</span>
      </span>
    </label>
  );
}

type AppUser = { id: string; email: string; full_name: string | null; role: string; active: boolean; created_at: string };

function UsersSettings() {
  const { profile, refreshProfile } = useAuth();
  const notify = useNotify();
  const users = useAsync(async () => unwrap(await supabase.from("app_users").select("*").order("created_at")) as AppUser[], []);
  const [editing, setEditing] = useState<AppUser | null>(null);

  return (
    <div className="space-y-3">
      <div className="eg-card !p-4 text-xs text-subtext leading-relaxed">
        لإضافة مستخدم: أنشئ الحساب من Supabase ← Authentication ← Users (أو من شاشة التسجيل إن كانت مفعّلة). يظهر هنا تلقائياً كحساب
        <Badge tone="warning" className="mx-1">غير مفعّل</Badge>؛ فعّله وحدد صلاحيته.
      </div>
      <AsyncBoundary loading={users.loading && !users.data} error={users.error} onRetry={users.reload}>
        <div className="eg-card !p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="eg-table">
              <thead><tr><th>المستخدم</th><th>الصلاحية</th><th>الحالة</th><th>تاريخ التسجيل</th><th></th></tr></thead>
              <tbody>
                {(users.data ?? []).map(u => (
                  <tr key={u.id}>
                    <td><p className="font-medium text-text">{u.full_name ?? "—"}</p><p className="text-[11px] text-subtext" dir="ltr">{u.email}</p></td>
                    <td>{roleLabel(u.role)}</td>
                    <td><ActiveBadge active={u.active} /></td>
                    <td className="text-[11px] text-subtext">{fmtDateTime(u.created_at)}</td>
                    <td><button onClick={() => setEditing(u)} className="text-xs text-accent hover:underline">تعديل</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </AsyncBoundary>
      {editing && (
        <UserForm user={editing} isSelf={editing.id === profile?.id} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); notify.success("تم حفظ المستخدم"); await users.reload(); await refreshProfile(); }} />
      )}
    </div>
  );
}

function UserForm({ user, isSelf, onClose, onSaved }: { user: AppUser; isSelf: boolean; onClose: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [role, setRole] = useState(user.role);
  const [active, setActive] = useState(user.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const categories = useAsync(listCategories, []);
  const grants = useAsync(async () => unwrap(await supabase.from("user_category_access").select("category_id").eq("user_id", user.id)) as { category_id: number }[], [user.id]);
  // null until the admin touches the list; then the admin's selection wins
  const [picked, setPicked] = useState<number[] | null>(null);
  const selected = picked ?? (grants.data ?? []).map(g => g.category_id);
  const ready = !!categories.data && !!grants.data;
  const toggleCategory = (id: number) => setPicked(prev => {
    const base = prev ?? selected;
    return base.includes(id) ? base.filter(x => x !== id) : [...base, id];
  });

  const save = async () => {
    setBusy(true); setError("");
    try {
      unwrap(await supabase.from("app_users").update({ full_name: fullName.trim() || null, role, active }).eq("id", user.id).select("id").single());
      unwrap(await supabase.rpc("set_user_category_access", { p_user_id: user.id, p_category_ids: role === "seller" ? selected : [] }));
      onSaved();
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`تعديل ${user.email}`} size="sm">
      <div className="space-y-4">
        <Field label="الاسم">
          <input value={fullName} onChange={e => setFullName(e.target.value)} className="eg-input" />
        </Field>
        <Field label="الصلاحية" hint={isSelf ? "انتبه: تغيير صلاحيتك قد يمنعك من فتح هذه الصفحة" : undefined}>
          <select value={role} onChange={e => setRole(e.target.value)} className="eg-select">
            {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="الحالة">
          <select value={active ? "1" : "0"} onChange={e => setActive(e.target.value === "1")} className="eg-select">
            <option value="1">مفعّل</option><option value="0">موقوف</option>
          </select>
        </Field>
        {role === "seller" && (
          <div>
            <p className="eg-label">التصنيفات المسموح له بالبيع فيها</p>
            {!ready ? <p className="text-xs text-subtext">جاري التحميل...</p> : (
              <div className="flex flex-wrap gap-2">
                {(categories.data ?? []).map(c => (
                  <button key={c.id} type="button" onClick={() => toggleCategory(c.id)}
                    className={cn("px-3 py-1.5 rounded-lg border text-xs transition-colors",
                      selected.includes(c.id) ? "border-accent bg-accent/15 text-text font-semibold" : "border-border bg-card2 text-subtext hover:text-text")}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-subtext mt-1.5 leading-relaxed">
              البائع يرى ويبيع في التصنيفات المختارة فقط، ويرى فواتير اليوم التي تحتوي عليها فقط. بدون اختيار لا يرى أي شيء.
            </p>
          </div>
        )}
        <FormError message={error} />
        <button onClick={save} disabled={busy || !ready} className="eg-btn-primary w-full justify-center">{busy ? "جاري الحفظ..." : "حفظ"}</button>
      </div>
    </Modal>
  );
}

type AuditRow = { id: number; table_name: string; record_id: string; action: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; actor_id: string | null; created_at: string };

const TABLE_LABEL: Record<string, string> = {
  categories: "تصنيف", products: "منتج", bottle_sizes: "حجم زجاجة", oil_types: "نوع زيت",
  oil_consumption_rules: "قاعدة استهلاك", perfume_prices: "سعر", perfume_extra_components: "مكون إضافي",
  inventory_items: "صنف مخزون", app_users: "مستخدم", app_settings: "إعداد",
};
const ACTION: Record<string, { label: string; tone: "success" | "accent" | "danger" }> = {
  INSERT: { label: "إضافة", tone: "success" }, UPDATE: { label: "تعديل", tone: "accent" }, DELETE: { label: "حذف", tone: "danger" },
};

function AuditLog() {
  const logs = useAsync(async () => {
    const [rows, names] = await Promise.all([
      supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200).then(unwrap) as Promise<AuditRow[]>,
      supabase.from("user_directory").select("id, display_name").then(unwrap) as Promise<{ id: string; display_name: string }[]>,
    ]);
    return { rows, names: Object.fromEntries(names.map(n => [n.id, n.display_name])) as Record<string, string> };
  }, []);
  const [open, setOpen] = useState<number | null>(null);

  const changes = (r: AuditRow) => {
    if (r.action !== "UPDATE" || !r.old_data || !r.new_data) return [];
    return Object.keys(r.new_data).filter(k => k !== "updated_at" && JSON.stringify(r.old_data![k]) !== JSON.stringify(r.new_data![k]))
      .map(k => ({ k, from: r.old_data![k], to: r.new_data![k] }));
  };
  const label = (r: AuditRow) => {
    const d = (r.new_data ?? r.old_data ?? {}) as Record<string, unknown>;
    return String(d.name ?? d.email ?? d.key ?? `#${r.record_id}`);
  };

  return (
    <AsyncBoundary loading={logs.loading && !logs.data} error={logs.error} onRetry={logs.reload}>
      {logs.data && logs.data.rows.length === 0 ? <div className="eg-card"><EmptyState message="لا توجد تعديلات مسجلة" /></div> : (
        <div className="eg-card !p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="eg-table">
              <thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>السجل</th><th></th></tr></thead>
              <tbody>
                {(logs.data?.rows ?? []).map(r => (
                  <Fragment key={r.id}>
                    <tr>
                      <td className="text-[11px] whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                      <td className="text-xs">{(r.actor_id && logs.data!.names[r.actor_id]) || "النظام"}</td>
                      <td><Badge tone={ACTION[r.action]?.tone}>{ACTION[r.action]?.label}</Badge> <span className="text-xs text-subtext">{TABLE_LABEL[r.table_name] ?? r.table_name}</span></td>
                      <td className="text-xs">{label(r)}</td>
                      <td>{changes(r).length > 0 && <button onClick={() => setOpen(open === r.id ? null : r.id)} className="text-xs text-accent hover:underline">التفاصيل</button>}</td>
                    </tr>
                    {open === r.id && (
                      <tr><td colSpan={5} className="bg-card2/60">
                        <ul className="text-[11px] space-y-1" dir="ltr">
                          {changes(r).map(c => <li key={c.k}><span className="text-subtext">{c.k}:</span> {JSON.stringify(c.from)} → <span className="text-text">{JSON.stringify(c.to)}</span></li>)}
                        </ul>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AsyncBoundary>
  );
}
