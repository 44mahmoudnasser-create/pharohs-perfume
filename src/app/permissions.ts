// UI permissions per role. They only decide what is shown; the same rules are
// enforced in the database (RLS + function checks — see migration 0700).

export const ROLE_LABEL: Record<string, string> = {
  admin: "مدير النظام",
  manager: "مدير المتجر",
  seller: "بائع",
};

export const roleLabel = (role?: string | null) => (role && ROLE_LABEL[role]) || "مستخدم";

const SELLER = ["sales.create", "inventory.view"] as const;

const MANAGER = [
  ...SELLER,
  "sales.viewAll", "sales.cancel",
  "catalog.manage",
  "inventory.manage", "inventory.history",
  "perfume.view", "prices.manage",
  "reports.view",
  "audit.view",
] as const;

const ADMIN = [...MANAGER, "perfume.configure", "settings.manage"] as const;

export const PERMISSIONS: Record<string, readonly string[]> = {
  seller: SELLER,
  manager: MANAGER,
  admin: ADMIN,
};
