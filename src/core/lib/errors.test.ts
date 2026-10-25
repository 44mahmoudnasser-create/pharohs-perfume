import { describe, expect, it } from "vitest";
import { AppError, errorMessage, unwrap } from "./errors";

describe("errorMessage", () => {
  it("passes through Arabic messages raised by our database functions", () => {
    expect(errorMessage({ code: "P0001", message: "المخزون غير كافٍ" })).toBe("المخزون غير كافٍ");
  });

  it("explains that a foreign-key violation means the row is in use", () => {
    expect(errorMessage({ code: "23503", message: "update or delete violates foreign key" })).toContain("استخدم الإيقاف");
  });

  it("maps duplicate, permission and check violations", () => {
    expect(errorMessage({ code: "23505", message: "duplicate key" })).toContain("مسجلة");
    expect(errorMessage({ code: "42501", message: "permission denied for table x" })).toContain("ليس لديك صلاحية");
    expect(errorMessage({ code: "23514", message: "check failed" })).toContain("غير صالحة");
  });

  it("explains network failures in plain language", () => {
    expect(errorMessage(new Error("Failed to fetch"))).toContain("تعذر الاتصال");
  });

  it("maps invalid login credentials", () => {
    expect(errorMessage({ message: "Invalid login credentials" })).toContain("غير صحيحة");
  });

  it("accepts plain strings and falls back for empty input", () => {
    expect(errorMessage("خطأ مخصص")).toBe("خطأ مخصص");
    expect(errorMessage(null)).toBe("حدث خطأ غير متوقع");
    expect(errorMessage({})).toBe("حدث خطأ غير متوقع");
  });
});

describe("unwrap", () => {
  it("returns the data when there is no error", () => {
    expect(unwrap({ data: 5, error: null })).toBe(5);
  });

  it("throws an AppError carrying the mapped message and code", () => {
    try {
      unwrap({ data: null, error: { code: "42501", message: "permission denied" } });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("42501");
      expect((e as AppError).message).toContain("ليس لديك صلاحية");
    }
  });
});
