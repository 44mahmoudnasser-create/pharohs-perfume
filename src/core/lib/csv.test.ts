import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("quotes cells containing commas, quotes or line breaks", () => {
    const csv = toCsv(["a", "b"], [["x, y", 'say "hi"'], [null, 3], ["line\nbreak", "ok"]]);
    expect(csv).toBe('a,b\r\n"x, y","say ""hi"""\r\n,3\r\n"line\nbreak",ok');
  });

  it("writes empty cells for null and undefined", () => {
    expect(toCsv(["a", "b"], [[undefined, null]])).toBe("a,b\r\n,");
  });

  it("returns only the header when there are no rows", () => {
    expect(toCsv(["الصنف", "الرصيد"], [])).toBe("الصنف,الرصيد");
  });
});
