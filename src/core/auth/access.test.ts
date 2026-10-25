import { describe, expect, it } from "vitest";
import { hasPermission, type PermissionMap } from "./access";
import { PERMISSIONS } from "@/app/permissions";

const map: PermissionMap = {
  seller: ["sales.create"],
  manager: ["sales.create", "inventory.view"],
};

describe("hasPermission", () => {
  it("grants a permission the role has", () => {
    expect(hasPermission({ role: "seller", active: true }, map, "sales.create")).toBe(true);
  });

  it("denies a permission the role lacks", () => {
    expect(hasPermission({ role: "seller", active: true }, map, "inventory.view")).toBe(false);
  });

  it("denies everything to an inactive user, whatever their role", () => {
    expect(hasPermission({ role: "manager", active: false }, map, "inventory.view")).toBe(false);
  });

  it("denies everything without a profile or for an unknown role", () => {
    expect(hasPermission(null, map, "sales.create")).toBe(false);
    expect(hasPermission(undefined, map, "sales.create")).toBe(false);
    expect(hasPermission({ role: "guest", active: true }, map, "sales.create")).toBe(false);
  });
});

describe("the application's real role map", () => {
  const seller = { role: "seller", active: true };
  const manager = { role: "manager", active: true };

  it("never lets a seller see stock or configuration screens", () => {
    expect(hasPermission(seller, PERMISSIONS, "inventory.view")).toBe(false);
    expect(hasPermission(seller, PERMISSIONS, "perfume.view")).toBe(false);
    expect(hasPermission(seller, PERMISSIONS, "reports.view")).toBe(false);
    expect(hasPermission(seller, PERMISSIONS, "settings.manage")).toBe(false);
  });

  it("keeps the manager's inventory access after the seller refactor", () => {
    expect(hasPermission(manager, PERMISSIONS, "inventory.view")).toBe(true);
    expect(hasPermission(manager, PERMISSIONS, "sales.viewAll")).toBe(true);
  });
});
