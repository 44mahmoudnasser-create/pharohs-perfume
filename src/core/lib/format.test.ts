import { describe, expect, it } from "vitest";
import { daysAgo, fmtInt, fmtMoney, fmtNum, fmtQty, isoDate } from "./format";

const arInt = (n: number) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(n);

describe("number formatting", () => {
  it("shows a dash for missing values", () => {
    expect(fmtInt(null)).toBe("—");
    expect(fmtNum(undefined)).toBe("—");
    expect(fmtMoney(null)).toBe("—");
    expect(fmtQty(null, "g")).toBe("—");
  });

  it("uses Arabic locale digits and accepts numeric strings", () => {
    expect(fmtInt(1234)).toBe(arInt(1234));
    expect(fmtInt("1234")).toBe(arInt(1234));
  });

  it("formats money with two decimals and an optional currency", () => {
    expect(fmtMoney(1234.5, "ج.م")).toContain("ج.م");
    expect(fmtMoney(0)).not.toContain("ج.م");
  });

  it("attaches the unit label to quantities", () => {
    expect(fmtQty(5, "g")).toContain("جم");
    expect(fmtQty(2, "pcs")).toContain("قطعة");
  });
});

describe("dates", () => {
  it("builds a local yyyy-mm-dd date", () => {
    expect(isoDate(new Date(2026, 9, 25, 12, 0))).toBe("2026-10-25");
    expect(isoDate(new Date(2026, 0, 1, 0, 30))).toBe("2026-01-01");
  });

  it("counts days back from today", () => {
    expect(daysAgo(0)).toBe(isoDate());
    expect(daysAgo(1)).toBe(isoDate(new Date(Date.now() - 86400000)));
  });
});
