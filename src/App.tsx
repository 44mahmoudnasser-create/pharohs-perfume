import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Droplets } from "lucide-react";
import { AuthProvider, useAuth } from "@/core/auth/AuthProvider";
import LoginPage from "@/core/auth/LoginPage";
import { PendingActivation, RequirePermission } from "@/core/auth/Guards";
import AppShell from "@/core/layout/AppShell";
import { NotificationsProvider } from "@/core/ui/Notifications";
import { SettingsProvider, useShop } from "@/core/settings/SettingsProvider";
import { ErrorState, LoadingState } from "@/core/ui/States";
import { lazy } from "react";
import { isSupabaseConfigured } from "@/core/lib/supabase";
import { SaleModesProvider } from "@/modules/sales/saleModes";
import { stockItemSaleMode } from "@/modules/sales/StockItemLineEditor";
// Pages load on demand so the first screen doesn't download every module.
const DashboardPage = lazy(() => import("@/modules/dashboard/DashboardPage"));
const CategoriesPage = lazy(() => import("@/modules/catalog/CategoriesPage"));
const ProductsPage = lazy(() => import("@/modules/catalog/ProductsPage"));
const InventoryPage = lazy(() => import("@/modules/inventory/InventoryPage"));
const SalesPage = lazy(() => import("@/modules/sales/SalesPage"));
const NewSalePage = lazy(() => import("@/modules/sales/NewSalePage"));
const ReportsPage = lazy(() => import("@/modules/reports/ReportsPage"));
const SettingsPage = lazy(() => import("@/modules/settings/SettingsPage"));
const BottleSizesPage = lazy(() => import("@/perfume/BottleSizesPage"));
const OilTypesPage = lazy(() => import("@/perfume/OilTypesPage"));
const ConsumptionRulesPage = lazy(() => import("@/perfume/ConsumptionRulesPage"));
import { perfumeSaleMode } from "@/perfume";
import { PERMISSIONS, roleLabel } from "@/app/permissions";
import { NAV } from "@/app/nav";

// Composition root: reusable core + reusable modules + perfume module.
const SALE_MODES = [perfumeSaleMode, stockItemSaleMode];
const APP_SUBTITLE = "نظام إدارة متجر العطور";

export default function App() {
  if (!isSupabaseConfigured) return <SetupRequired />;
  return (
    <NotificationsProvider>
      <AuthProvider permissions={PERMISSIONS}>
        <HashRouter>
          <Gate />
        </HashRouter>
      </AuthProvider>
    </NotificationsProvider>
  );
}

function Gate() {
  const { session, profile, profileError, loading, refreshProfile } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><LoadingState /></div>;
  if (!session) return <LoginPage appName="عطور الفراعنة" appSubtitle={APP_SUBTITLE} />;
  if (profileError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="eg-card max-w-md w-full">
          <ErrorState message={`تعذر تحميل بيانات حسابك: ${profileError}`} onRetry={() => void refreshProfile()} />
        </div>
      </div>
    );
  }
  if (!profile) return <div className="min-h-screen flex items-center justify-center"><LoadingState /></div>;
  if (!profile.active || !PERMISSIONS[profile.role]) return <PendingActivation />;
  return (
    <SettingsProvider enabled>
      <SaleModesProvider modes={SALE_MODES}>
        <AppRoutes />
      </SaleModesProvider>
    </SettingsProvider>
  );
}

function AppRoutes() {
  const { name } = useShop();
  const guard = (permission: string, el: React.ReactNode) => <RequirePermission permission={permission}>{el}</RequirePermission>;
  return (
    <Routes>
      <Route element={<AppShell brandName={name} brandSubtitle={APP_SUBTITLE} logo={<Droplets className="w-5 h-5" />} nav={NAV} roleLabel={roleLabel} />}>
        <Route index element={<DashboardPage />} />
        <Route path="sales" element={<SalesPage />} />
        <Route path="sales/new" element={guard("sales.create", <NewSalePage />)} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="perfume/bottle-sizes" element={guard("perfume.view", <BottleSizesPage />)} />
        <Route path="perfume/oil-types" element={guard("perfume.view", <OilTypesPage />)} />
        <Route path="perfume/rules" element={guard("perfume.view", <ConsumptionRulesPage />)} />
        <Route path="inventory" element={guard("inventory.view", <InventoryPage />)} />
        <Route path="reports" element={guard("reports.view", <ReportsPage />)} />
        <Route path="settings" element={guard("settings.manage", <SettingsPage />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function SetupRequired() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="eg-card max-w-md space-y-3">
        <h1 className="text-base font-bold text-text">إعداد الاتصال بـ Supabase مطلوب</h1>
        <p className="text-sm text-subtext leading-relaxed">
          لم يتم ضبط <code dir="ltr">VITE_SUPABASE_URL</code> و <code dir="ltr">VITE_SUPABASE_ANON_KEY</code>.
          انسخ ملف <code dir="ltr">.env.example</code> إلى <code dir="ltr">.env.local</code> واملأ القيم، أو أضفها كمتغيرات في GitHub Actions.
        </p>
      </div>
    </div>
  );
}
