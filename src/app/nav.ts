import {
  BarChart3, Boxes, Droplet, FlaskConical, LayoutDashboard, Package, Receipt, Settings,
  ShoppingCart, Tags, Wine,
} from "lucide-react";
import type { NavItem } from "@/core/layout/AppShell";

export const NAV: NavItem[] = [
  { to: "/", label: "لوحة التحكم", icon: LayoutDashboard, end: true },
  { to: "/sales/new", label: "بيع جديد", icon: ShoppingCart, permission: "sales.create", section: "المبيعات" },
  { to: "/sales", label: "الفواتير", icon: Receipt, section: "المبيعات", end: true },
  { to: "/products", label: "المنتجات", icon: Package, section: "الكتالوج" },
  { to: "/categories", label: "التصنيفات", icon: Tags, section: "الكتالوج" },
  { to: "/perfume/bottle-sizes", label: "أحجام الزجاجات", icon: Wine, permission: "perfume.view", section: "إعدادات العطور" },
  { to: "/perfume/oil-types", label: "أنواع الزيوت", icon: Droplet, permission: "perfume.view", section: "إعدادات العطور" },
  { to: "/perfume/rules", label: "قواعد الاستهلاك والأسعار", icon: FlaskConical, permission: "perfume.view", section: "إعدادات العطور" },
  { to: "/inventory", label: "المخزون", icon: Boxes, permission: "inventory.view", section: "المخزون والتقارير" },
  { to: "/reports", label: "التقارير", icon: BarChart3, permission: "reports.view", section: "المخزون والتقارير" },
  { to: "/settings", label: "الإعدادات", icon: Settings, permission: "settings.manage", section: "النظام" },
];
