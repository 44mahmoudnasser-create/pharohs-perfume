import { Suspense, useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { KeyRound, LogOut, Menu, X, type LucideIcon } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { useAuth } from "@/core/auth/AuthProvider";
import ChangePasswordModal from "@/core/auth/ChangePasswordModal";
import { LoadingState } from "@/core/ui/States";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Only shown when the user has this permission (UI only). */
  permission?: string;
  /** Optional group heading shown above the item. */
  section?: string;
  end?: boolean;
};

export const initials = (name?: string | null, email?: string | null) => {
  const src = (name ?? "").trim() || (email ?? "").split("@")[0] || "?";
  const parts = src.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
};

/**
 * Reusable application shell: right-side sidebar on desktop, drawer + top bar
 * on mobile (same behaviour as the factory system).
 */
export default function AppShell({
  brandName, brandSubtitle, logo, nav, roleLabel,
}: {
  brandName: string;
  brandSubtitle: string;
  logo: React.ReactNode;
  nav: NavItem[];
  roleLabel: (role: string) => string;
}) {
  const { profile, can, signOut } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const location = useLocation();
  const close = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => { close(); }, [location.pathname, close]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, close]);

  const items = nav.filter(n => !n.permission || can(n.permission));
  const displayName = profile?.full_name || profile?.email || "—";

  return (
    <div className="flex min-h-screen">
      {/* mobile backdrop */}
      <div onClick={close}
        className={cn("fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity",
          drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none")} />

      <aside className={cn(
        "fixed inset-y-0 right-0 z-50 w-64 bg-card flex flex-col border-l border-border/50 transition-transform duration-200",
        drawerOpen ? "translate-x-0" : "translate-x-full",
        "md:sticky md:top-0 md:h-screen md:self-start md:z-auto md:w-60 md:translate-x-0 md:shrink-0",
      )}>
        <div className="p-5 border-b border-border/50 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 shrink-0 bg-accent rounded-lg flex items-center justify-center text-white">{logo}</div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-text leading-tight truncate">{brandName}</p>
              <p className="text-[10px] text-subtext leading-tight mt-0.5 truncate">{brandSubtitle}</p>
            </div>
          </div>
          <button onClick={close} className="md:hidden p-1.5 text-subtext hover:text-text" aria-label="إغلاق القائمة">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 min-h-0 p-3 space-y-0.5 overflow-y-auto">
          {items.map(({ to, icon: Icon, label, section, end }, i) => (
            <div key={to}>
              {section && section !== items[i - 1]?.section && (
                <p className="px-3 pt-3 pb-1 text-[10px] font-semibold text-subtext/70">{section}</p>
              )}
              <NavLink to={to} end={end}
                className={({ isActive }) => cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all",
                  isActive ? "bg-accent text-white font-semibold" : "text-subtext hover:bg-border/50 hover:text-text",
                )}>
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </NavLink>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-border/50">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-card2">
            <div className="w-9 h-9 shrink-0 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-bold">
              {initials(profile?.full_name, profile?.email)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-text truncate">{displayName}</p>
              <p className="text-[10px] text-subtext truncate">{roleLabel(profile?.role ?? "")}</p>
            </div>
          </div>
          <button onClick={() => setPwOpen(true)}
            className="mt-2 flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-subtext hover:bg-border/50 hover:text-text w-full transition-all">
            <KeyRound className="w-4 h-4" />تغيير كلمة المرور
          </button>
          <button onClick={() => void signOut()}
            className="mt-1 flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-subtext hover:bg-danger/10 hover:text-danger w-full transition-all">
            <LogOut className="w-4 h-4" />تسجيل الخروج
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="md:hidden sticky top-0 z-30 h-14 bg-card/95 backdrop-blur border-b border-border/50 flex items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setDrawerOpen(true)} className="p-2 -mr-2 rounded-lg text-text hover:bg-border/50" aria-label="فتح القائمة">
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm font-bold text-accent truncate">{brandName}</span>
          </div>
          <button onClick={() => setDrawerOpen(true)} aria-label="بيانات المستخدم"
            className="w-8 h-8 shrink-0 rounded-full bg-accent/20 text-accent text-[11px] font-bold flex items-center justify-center">
            {initials(profile?.full_name, profile?.email)}
          </button>
        </header>

        <main className="flex-1 min-w-0">
          <div className="max-w-6xl mx-auto">
            <Suspense fallback={<LoadingState />}><Outlet /></Suspense>
          </div>
        </main>
      </div>

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} email={profile?.email ?? null} />
    </div>
  );
}
