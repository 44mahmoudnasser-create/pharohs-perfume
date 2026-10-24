// UI permissions per role. They only decide what is shown; the same rules are
// enforced in the database (RLS + function checks — see migrations 0700 and 0800).

export const ROLE_LABEL: Record<string, string> = {
  admin: "مدير النظام",
  manager: "مدير المتجر",
  seller: "بائع",
};

export const roleLabel = (role?: string | null) => (role && ROLE_LABEL[role]) || "مستخدم";

// A seller only sells. Which categories they see is decided per user by an admin.
const SELLER = ["sales.create"] as const;

const MANAGER = [
  ...SELLER,
  "inventory.view", "inventory.manage", "inventory.history",
  "sales.viewAll", "sales.cancel",
  "catalog.manage",
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
